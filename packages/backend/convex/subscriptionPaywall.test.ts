import { expect, it, vi } from "vitest";
import { createEmptyTimeline } from "@dirrio/shared";
import { api, internal } from "../../../apps/api/src/operations";
import { authIdentity, createTestUser, makeTest } from "../test/helpers";
async function fixture() {
  const t = makeTest();
  const userId = await createTestUser(t, "paywall-owner@test.com");
  const creatorId = await createTestUser(t, "paywall-creator@test.com");
  const owner = t.withIdentity(authIdentity(userId));
  const creator = t.withIdentity(authIdentity(creatorId));
  const workspaceId = await owner.mutation(
    api.users.ensurePersonalWorkspace,
    {},
  );
  const projectId = await owner.mutation(api.projects.create, {
    title: "Paywall",
  });
  await owner.mutation(api.workspace.saveScript, {
    projectId,
    text: "Saved script",
  });
  const seriesId = await owner.mutation(api.series.create, {
    workspaceId,
    title: "Series",
  });
  await t.run(async (ctx) => {
    await ctx.db.insert("workspaceMembers", {
      workspaceId,
      userId: creatorId,
      role: "creator",
      createdAt: Date.now(),
    });
    await ctx.db.insert("productionAssignments", {
      workspaceId,
      userId: creatorId,
      projectId,
      manageReviews: false,
    });
  });
  const claim = await owner.mutation(api.timelineLeases.claim, {
    projectId,
    sessionId: "owner-tab",
  });
  if (!claim.held) throw Error("Missing lease");
  const document = createEmptyTimeline({
    id: projectId,
    aspectRatio: "16:9",
    fps: 24,
  });
  document.durationSec = 1;
  const saved = await owner.action(api.timelineVersions.save, {
    projectId,
    parentId: null,
    document,
    requestId: "initial",
    sessionId: "owner-tab",
    fence: claim.fence,
  });
  const storageId = await t.run((ctx) =>
    ctx.storage.store(new Blob(["fixture"], { type: "video/mp4" })),
  );
  const now = Date.now();
  const sub = {
    workspaceId,
    environment: "sandbox" as const,
    customerId: "customer",
    subscriptionId: "sub",
    status: "active",
    seats: 2,
    periodStart: now - 1000,
    periodEnd: now + 86400_000,
    cancelAtPeriodEnd: false,
    providerUpdatedAt: now,
  };
  async function activate() {
    await t.mutation(internal.payments.applySubscription, sub);
    await t.mutation(internal.payments.applyOrder, {
      workspaceId,
      environment: "sandbox",
      customerId: "customer",
      subscriptionId: "sub",
      orderId: "paid",
      kind: "subscription",
      netCents: 4400,
      refundedCents: 0,
      paid: true,
      createdAt: now,
      billingReason: "subscription_create",
      seats: 2,
      periodStart: sub.periodStart,
      periodEnd: sub.periodEnd,
    });
  }
  async function expire() {
    await t.mutation(internal.payments.applySubscription, {
      ...sub,
      status: "canceled",
      providerUpdatedAt: now + 100,
    });
  }
  return {
    t,
    userId,
    creatorId,
    owner,
    creator,
    workspaceId,
    projectId,
    seriesId,
    claim,
    document,
    saved,
    storageId,
    sub,
    activate,
    expire,
  };
}
it("leaves unbound development workspaces usable while the rollout flag is off; blocks them when enabled", async () => {
  const f = await fixture();
  expect(
    (
      await f.owner.query(api.payments.entitlements, {
        workspaceId: f.workspaceId,
      })
    ).canWrite,
  ).toBe(true);
  vi.stubEnv("SUBSCRIPTION_PAYWALL_ENABLED", "true");
  expect(
    (
      await f.owner.query(api.payments.entitlements, {
        workspaceId: f.workspaceId,
      })
    ).code,
  ).toBe("SUBSCRIPTION_REQUIRED");
  await expect(
    f.owner.mutation(api.storage.createUploadUrl, { projectId: f.projectId }),
  ).rejects.toThrow("active paid");
  await expect(
    f.owner.mutation(api.projects.create, {
      workspaceId: f.workspaceId,
      title: "Bypass",
    }),
  ).rejects.toThrow("active paid");
  expect(
    await f.owner.query(api.projects.get, { projectId: f.projectId }),
  ).not.toBeNull();
});
it("allows active subscribed editing and scoped uploads without enabling checkout", async () => {
  const f = await fixture();
  await f.activate();
  const script = await f.owner.query(api.workspace.list, {
    projectId: f.projectId,
  });
  await f.owner.mutation(api.workspace.saveScript, {
    projectId: f.projectId,
    text: "Paid edit",
    expectedId: script.script!._id,
  });
  expect(
    await f.owner.mutation(api.storage.createUploadUrl, {
      projectId: f.projectId,
    }),
  ).toBeTypeOf("string");
  expect(
    (
      await f.creator.query(api.payments.entitlements, {
        workspaceId: f.workspaceId,
      })
    ).canWrite,
  ).toBe(true);
  expect(process.env.POLAR_PAYMENTS_ENABLED).toBe("false");
});
it("blocks editor claims, renewals, saves and direct commits after cancellation while retaining history and local recovery inputs", async () => {
  const f = await fixture();
  await f.activate();
  await f.expire();
  await expect(
    f.creator.mutation(api.timelineLeases.claim, {
      projectId: f.projectId,
      sessionId: "creator",
    }),
  ).rejects.toThrow("active paid");
  await expect(
    f.owner.mutation(api.timelineLeases.renew, {
      projectId: f.projectId,
      sessionId: "owner-tab",
      fence: f.claim.fence,
    }),
  ).rejects.toThrow("active paid");
  await expect(
    f.owner.action(api.timelineVersions.save, {
      projectId: f.projectId,
      parentId: f.saved.versionId,
      document: f.document,
      requestId: "new",
      sessionId: "owner-tab",
      fence: f.claim.fence,
    }),
  ).rejects.toThrow("active paid");
  await expect(
    f.owner.mutation(internal.timelineVersions.commitSnapshot, {
      projectId: f.projectId,
      parentId: f.saved.versionId,
      timelineFileId: f.storageId,
      mediaAssetIds: [],
      requestId: "direct",
      sessionId: "owner-tab",
      fence: f.claim.fence,
    }),
  ).rejects.toThrow("active paid");
  expect(
    (
      await f.owner.action(api.timelineVersions.getContent, {
        projectId: f.projectId,
      })
    ).version!._id,
  ).toBe(f.saved.versionId);
  expect(
    await f.creator.query(api.timelineVersions.listForProject, {
      projectId: f.projectId,
    }),
  ).toHaveLength(1);
  await f.owner.mutation(api.timelineLeases.release, {
    projectId: f.projectId,
    sessionId: "owner-tab",
    fence: f.claim.fence,
  });
});
it("blocks script, staging and reference edits on direct endpoints for Owner and Creator", async () => {
  const f = await fixture();
  await f.activate();
  await f.expire();
  for (const actor of [f.owner, f.creator]) {
    await expect(
      actor.mutation(api.workspace.saveScript, {
        projectId: f.projectId,
        text: "Bypass",
      }),
    ).rejects.toThrow("active paid");
    await expect(
      actor.mutation(internal.workspace.commitStaging, {
        projectId: f.projectId,
        name: "Bypass",
        contentFileId: f.storageId,
      }),
    ).rejects.toThrow("active paid");
    await expect(
      actor.mutation(api.projects.update, {
        projectId: f.projectId,
        title: "Bypass",
      }),
    ).rejects.toThrow("active paid");
  }
  expect(
    (await f.owner.action(api.workspace.script, { projectId: f.projectId }))
      .text,
  ).toBe("Saved script");
});
it("rejects new upload URLs and preissued-upload attachment after expiry, including series resources", async () => {
  const f = await fixture();
  await f.activate();
  await f.owner.mutation(api.storage.createUploadUrl, {
    projectId: f.projectId,
  });
  await f.owner.mutation(api.resources.createUploadUrl, {
    seriesId: f.seriesId,
  });
  await f.expire();
  await expect(
    f.owner.mutation(api.storage.createUploadUrl, { projectId: f.projectId }),
  ).rejects.toThrow("active paid");
  await expect(
    f.creator.mutation(api.storage.createAssetFromUpload, {
      projectId: f.projectId,
      storageId: f.storageId,
      type: "video",
      name: "Late upload",
    }),
  ).rejects.toThrow("active paid");
  await expect(
    f.owner.mutation(api.resources.createUploadUrl, { seriesId: f.seriesId }),
  ).rejects.toThrow("active paid");
  await expect(
    f.owner.mutation(api.resources.completeUpload, {
      seriesId: f.seriesId,
      storageId: f.storageId,
      type: "video",
      name: "Late resource",
    }),
  ).rejects.toThrow("active paid");
  expect(await f.t.run((ctx) => ctx.db.query("assets").collect())).toHaveLength(
    0,
  );
});
it("checks subscriptions before storing generic JSON or a staged timeline file", async () => {
  const f = await fixture();
  await f.activate();
  await f.expire();
  const before = await f.t.run((ctx) =>
    ctx.db.system.query("_storage").collect(),
  );
  await expect(
    f.owner.action(api.storage.storeJson, {
      projectId: f.projectId,
      value: { bypass: true },
    }),
  ).rejects.toThrow("active paid");
  await expect(
    f.owner.action(api.timelineVersions.save, {
      projectId: f.projectId,
      parentId: f.saved.versionId,
      document: f.document,
      requestId: "bypass",
      sessionId: "owner-tab",
      fence: f.claim.fence,
    }),
  ).rejects.toThrow("active paid");
  expect(
    await f.t.run((ctx) => ctx.db.system.query("_storage").collect()),
  ).toHaveLength(before.length);
});
it("blocks publication intent/upload/finalization but retains stored video download access", async () => {
  const f = await fixture();
  await f.activate();
  const publication = await f.owner.action(api.publishedExports.begin, {
    projectId: f.projectId,
    versionId: f.saved.versionId,
    requestId: "publication",
  });
  await f.owner.mutation(internal.publishedExports.claimUpload, {
    publicationId: publication.publicationId,
    attempt: "upload",
  });
  await f.expire();
  await expect(
    f.owner.action(api.publishedExports.begin, {
      projectId: f.projectId,
      versionId: f.saved.versionId,
      requestId: "new-publication",
    }),
  ).rejects.toThrow("active paid");
  await expect(
    f.owner.mutation(internal.publishedExports.claimUpload, {
      publicationId: publication.publicationId,
      attempt: "again",
    }),
  ).rejects.toThrow("active paid");
  await expect(
    f.owner.mutation(internal.publishedExports.finalize, {
      publicationId: publication.publicationId,
      attempt: "upload",
      storageId: f.storageId,
      sizeBytes: 7,
      sha256: "a".repeat(64),
      durationSec: 1,
      width: 1920,
      height: 1080,
    }),
  ).rejects.toThrow("active paid");
  await f.t.run((ctx) =>
    ctx.db.patch(publication.publicationId, {
      state: "ready",
      storageId: f.storageId,
      sizeBytes: 7,
      sha256: "a".repeat(64),
    }),
  );
  expect(
    (
      await f.creator.query(internal.publishedExports.getForDelivery, {
        publicationId: publication.publicationId,
      })
    ).storageId,
  ).toBe(f.storageId);
  expect(
    await f.owner.query(api.publishedExports.list, { projectId: f.projectId }),
  ).toHaveLength(1);
});
it("honors grace and renewal recovery, and does not allow staff or extra unpaid seats to bypass the editor gate", async () => {
  const f = await fixture();
  await f.activate();
  await f.t.mutation(internal.payments.applySubscription, {
    ...f.sub,
    status: "past_due",
    pastDueAt: Date.now() - 2 * 86400_000,
    providerUpdatedAt: Date.now() + 1,
  });
  expect(
    (
      await f.owner.query(api.payments.entitlements, {
        workspaceId: f.workspaceId,
      })
    ).canWrite,
  ).toBe(true);
  await f.t.mutation(internal.payments.applySubscription, {
    ...f.sub,
    status: "past_due",
    pastDueAt: Date.now() - 8 * 86400_000,
    providerUpdatedAt: Date.now() + 2,
  });
  await f.t.run((ctx) => ctx.db.patch(f.userId, { isStaff: true }));
  await expect(
    f.owner.mutation(api.storage.createUploadUrl, { projectId: f.projectId }),
  ).rejects.toThrow("active paid");
  await f.t.mutation(internal.payments.applySubscription, {
    ...f.sub,
    providerUpdatedAt: Date.now() + 3,
  });
  expect(
    (
      await f.owner.query(api.payments.entitlements, {
        workspaceId: f.workspaceId,
      })
    ).canWrite,
  ).toBe(true);
  const third = await createTestUser(f.t, "extra@test.com");
  await f.t.run((ctx) =>
    ctx.db.insert("workspaceMembers", {
      workspaceId: f.workspaceId,
      userId: third,
      role: "admin",
      createdAt: Date.now(),
    }),
  );
  await expect(
    f.owner.mutation(api.timelineLeases.claim, {
      projectId: f.projectId,
      sessionId: "bypass",
    }),
  ).rejects.toThrow("more creators than paid seats");
});
it("does not disclose subscription status or grant a scoped upload to a nonmember", async () => {
  const f = await fixture();
  await f.activate();
  await f.expire();
  const outsider = await createTestUser(f.t, "outsider@test.com");
  const stranger = f.t.withIdentity(authIdentity(outsider));
  await expect(
    stranger.query(api.payments.entitlements, { workspaceId: f.workspaceId }),
  ).rejects.toThrow("access denied");
  await expect(
    stranger.mutation(api.storage.createUploadUrl, { projectId: f.projectId }),
  ).rejects.toThrow("access denied");
});
