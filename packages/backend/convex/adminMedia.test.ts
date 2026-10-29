import { afterEach, expect, it, vi } from "vitest";
import { api, internal } from "../../../apps/api/src/operations";
import { authIdentity, createTestUser, makeTest } from "../test/helpers";
import * as r2 from "../../../apps/api/src/services/r2";
afterEach(() => vi.restoreAllMocks());
async function fixture() {
  const t = makeTest(),
    userId = await createTestUser(t, "media-owner@test.com"),
    adminId = await createTestUser(t, "media-admin@test.com", {
      isStaff: true,
    }),
    moderatorId = await createTestUser(t, "media-moderator@test.com", {
      isStaff: true,
    }),
    opsId = await createTestUser(t, "media-ops@test.com", { isStaff: true });
  await t.run(async (ctx) => {
    await ctx.db.patch(moderatorId, { adminRoles: ["moderation"] });
    await ctx.db.patch(opsId, { adminRoles: ["operations"] });
  });
  const user = t.withIdentity(authIdentity(userId)),
    admin = t.withIdentity(authIdentity(adminId)),
    moderator = t.withIdentity(authIdentity(moderatorId)),
    ops = t.withIdentity(authIdentity(opsId));
  const projectId = await user.mutation(api.projects.create, {
      title: "Media review",
    }),
    workspaceId = (await user.query(api.projects.get, { projectId }))!
      .workspaceId;
  const fileId = await t.run((ctx) =>
    ctx.db.insert("r2Files", {
      key: "media/evidence-private-key",
      bucket: "test-media",
      size: 100,
      contentType: "image/png",
      workspaceId,
      createdBy: userId,
      createdAt: Date.now() - 72 * 3600000,
    }),
  );
  const assetId = await user.mutation(api.storage.createAssetFromUpload, {
    projectId,
    storageId: fileId,
    type: "image",
    name: "evidence.png",
  });
  const flagId = await t.mutation(internal.moderation.recordFlag, {
    userId,
    projectId,
    assetId,
    stage: "output",
    verdict: "flagged",
    ruleId: "test.policy",
    snippet: "Private policy evidence",
  });
  const controls = {
    storageId: fileId,
    quarantined: true,
    retentionHold: true,
    expectedRevision: 0,
    reason: "Preserve this file for policy investigation",
    requestId: "hold-1",
  };
  const orphan = () =>
    t.run((ctx) =>
      ctx.db.insert("r2Files", {
        key: `media/orphan-${crypto.randomUUID()}`,
        bucket: "test-media",
        size: 42,
        contentType: "video/mp4",
        createdAt: Date.now() - 72 * 3600000,
      }),
    );
  return {
    t,
    user,
    admin,
    moderator,
    ops,
    userId,
    adminId,
    moderatorId,
    workspaceId,
    projectId,
    fileId,
    assetId,
    flagId,
    controls,
    orphan,
  };
}
it("separates metadata, moderation content and permanent cleanup permissions", async () => {
  const f = await fixture();
  await expect(
    f.user.query(api.adminMedia.inventory, {
      paginationOpts: { cursor: null, numItems: 25 },
    }),
  ).rejects.toThrow(/Staff/);
  await expect(
    f.ops.mutation(api.adminMedia.evidence, {
      flagId: f.flagId,
      reason: "Inspect private policy evidence",
      requestId: "read-1",
    }),
  ).rejects.toThrow(/permission/);
  await expect(
    f.moderator.mutation(api.adminMedia.cleanup, {
      fileId: await f.orphan(),
      reason: "Remove confirmed orphan media",
      requestId: "delete-1",
    }),
  ).rejects.toThrow(/permission/);
  expect(
    (
      await f.ops.query(api.adminMedia.inventory, {
        paginationOpts: { cursor: null, numItems: 25 },
      })
    ).page.length,
  ).toBeGreaterThan(0);
});
it("paginates flags without exposing snippets or private prompts", async () => {
  const f = await fixture();
  const flags = await f.moderator.query(api.adminMedia.flags, {
    status: "open",
    paginationOpts: { cursor: null, numItems: 1 },
  });
  expect(flags.page).toHaveLength(1);
  expect(JSON.stringify(flags)).not.toContain("Private policy evidence");
  expect(
    (
      await f.moderator.mutation(api.adminMedia.evidence, {
        flagId: f.flagId,
        reason: "Inspect evidence for the reported output",
        requestId: "read-1",
      })
    ).snippet,
  ).toBe("Private policy evidence");
  const audit = await f.t.run((ctx) =>
    ctx.db
      .query("auditLog")
      .filter((q) => q.eq(q.field("action"), "moderation.evidence"))
      .collect(),
  );
  expect(audit).toHaveLength(1);
  expect(audit[0]?.actorUserId).toBe(f.moderatorId);
});
it("records assignments and reversible decisions with stale-edit and replay protection", async () => {
  const f = await fixture(),
    args = {
      flagId: f.flagId,
      status: "resolved" as const,
      assignedTo: f.moderatorId,
      expectedRevision: 0,
      reason: "Reviewed the output and applied policy",
      requestId: "decision-1",
    };
  await f.moderator.mutation(api.adminMedia.decide, args);
  await f.moderator.mutation(api.adminMedia.decide, args);
  await expect(
    f.moderator.mutation(api.adminMedia.decide, {
      ...args,
      status: "dismissed",
    }),
  ).rejects.toThrow(/mismatch/);
  await expect(
    f.moderator.mutation(api.adminMedia.decide, {
      ...args,
      status: "open",
      requestId: "stale",
    }),
  ).rejects.toThrow(/flag changed/);
  await f.moderator.mutation(api.adminMedia.decide, {
    ...args,
    status: "open",
    expectedRevision: 1,
    requestId: "reopen-1",
  });
  expect((await f.t.run((ctx) => ctx.db.get(f.flagId)))?.status).toBe("open");
});
it("does not assign a moderation decision to a customer", async () => {
  const f = await fixture();
  await expect(
    f.moderator.mutation(api.adminMedia.decide, {
      flagId: f.flagId,
      status: "resolved",
      assignedTo: f.userId,
      expectedRevision: 0,
      reason: "Assign this case for investigation",
      requestId: "decision-1",
    }),
  ).rejects.toThrow(/active moderation administrator/);
});
it("quarantines all aliases, blocks new references and preserves the bytes", async () => {
  const f = await fixture();
  await f.moderator.mutation(api.adminMedia.control, f.controls);
  expect(
    await f.user.query(api.storage.getAssetUrl, { assetId: f.assetId }),
  ).toBeNull();
  expect(
    await f.t.query(internal.storageIO.lookupR2File, { id: f.fileId }),
  ).toBeNull();
  expect(
    await f.user.query(internal.storageIO.authorizeR2File, { id: f.fileId }),
  ).toBeNull();
  await expect(
    f.t.mutation(internal.generation.assertStartAllowed, {
      userId: f.userId,
      projectId: f.projectId,
      prompt: "Use this image",
      referenceAssetIds: [f.assetId],
    }),
  ).rejects.toThrow(/not found/);
  expect(await f.t.run((ctx) => ctx.db.get(f.fileId))).toBeTruthy();
  await expect(
    f.user.mutation(api.storage.deleteAsset, { assetId: f.assetId }),
  ).rejects.toThrow(/quarantined or under a retention hold/);
});
it("restores new media access only through an explicit fresh control revision", async () => {
  const f = await fixture();
  await f.moderator.mutation(api.adminMedia.control, f.controls);
  await f.moderator.mutation(api.adminMedia.control, f.controls);
  await expect(
    f.moderator.mutation(api.adminMedia.control, {
      ...f.controls,
      requestId: "stale",
    }),
  ).rejects.toThrow(/controls changed/);
  await f.moderator.mutation(api.adminMedia.control, {
    ...f.controls,
    quarantined: false,
    retentionHold: true,
    expectedRevision: 1,
    requestId: "restore-1",
  });
  expect(
    await f.user.query(api.storage.getAssetUrl, { assetId: f.assetId }),
  ).toBe(`r2://${f.fileId}`);
  await expect(
    f.user.mutation(api.storage.deleteAsset, { assetId: f.assetId }),
  ).rejects.toThrow(/retention hold/);
});
it("prevents held-file account deletion before metadata is purged", async () => {
  const f = await fixture();
  await f.moderator.mutation(api.adminMedia.control, f.controls);
  await expect(
    f.user.mutation(api.users.deleteAccount, { confirm: "DELETE" }),
  ).rejects.toThrow(/retention hold/);
  await expect(
    f.t.mutation(internal.users.purgeUserData, { userId: f.userId }),
  ).rejects.toThrow(/retention hold/);
  expect(await f.t.run((ctx) => ctx.db.get(f.assetId))).toBeTruthy();
  expect(await f.t.run((ctx) => ctx.db.get(f.projectId))).toBeTruthy();
});
it("retains held unassigned files during periodic storage cleanup", async () => {
  const f = await fixture(),
    fileId = await f.orphan();
  await f.admin.mutation(api.adminMedia.control, {
    ...f.controls,
    storageId: fileId,
  });
  await f.t.mutation(internal.storageIO.cleanupR2Uploads, {});
  expect(
    (await f.t.run((ctx) => ctx.db.get(fileId)))?.deletedAt,
  ).toBeUndefined();
});
it("only queues old unreferenced R2 files for cleanup and deduplicates retries", async () => {
  const f = await fixture(),
    fileId = await f.orphan(),
    args = {
      fileId,
      reason: "Confirmed abandoned unreferenced media",
      requestId: "cleanup-1",
    };
  await expect(
    f.admin.mutation(api.adminMedia.cleanup, { ...args, fileId: f.fileId }),
  ).rejects.toThrow(/still has references/);
  await f.admin.mutation(api.adminMedia.cleanup, args);
  await f.admin.mutation(api.adminMedia.cleanup, args);
  expect((await f.t.run((ctx) => ctx.db.get(fileId)))?.deletedAt).toBeDefined();
  expect(
    await f.t.run((ctx) => ctx.db.query("storageCleanupRequests").collect()),
  ).toHaveLength(1);
  const tasks = await f.t.run((ctx) =>
    ctx.db
      .query("apiTasks")
      .filter((q) => q.eq(q.field("operation"), "r2Storage:deleteObject"))
      .collect(),
  );
  expect(tasks).toHaveLength(1);
  await expect(
    f.admin.mutation(api.adminMedia.control, {
      ...f.controls,
      storageId: fileId,
    }),
  ).rejects.toThrow(/pending deletion/);
});
it("rejects recent files, retained files and upload-session references during cleanup", async () => {
  const f = await fixture(),
    fileId = await f.orphan(),
    args = {
      fileId,
      reason: "Investigate this candidate for deletion",
      requestId: "cleanup-1",
    };
  await f.t.run((ctx) => ctx.db.patch(fileId, { createdAt: Date.now() }));
  await expect(f.admin.mutation(api.adminMedia.cleanup, args)).rejects.toThrow(
    /48-hour/,
  );
  await f.t.run((ctx) =>
    ctx.db.patch(fileId, { createdAt: Date.now() - 72 * 3600000 }),
  );
  await f.admin.mutation(api.adminMedia.control, {
    ...f.controls,
    storageId: fileId,
  });
  await expect(f.admin.mutation(api.adminMedia.cleanup, args)).rejects.toThrow(
    /retention hold/,
  );
  await f.admin.mutation(api.adminMedia.control, {
    ...f.controls,
    storageId: fileId,
    quarantined: false,
    retentionHold: false,
    expectedRevision: 1,
    requestId: "release-1",
  });
  await f.t.run((ctx) =>
    ctx.db.insert("r2Uploads", {
      token: "upload-ref",
      key: "staging/test",
      fileId,
      workspaceId: f.workspaceId,
      createdBy: f.userId,
      expiresAt: Date.now() + 1000,
    }),
  );
  await expect(f.admin.mutation(api.adminMedia.cleanup, args)).rejects.toThrow(
    /still has references/,
  );
});
it("rechecks references before physical deletion and records completion only after success", async () => {
  const f = await fixture(),
    fileId = await f.orphan();
  await f.admin.mutation(api.adminMedia.cleanup, {
    fileId,
    reason: "Delete an old confirmed orphan",
    requestId: "cleanup-1",
  });
  vi.spyOn(r2, "removeObject").mockRejectedValueOnce(
    new Error("R2 unavailable"),
  );
  const row = await f.t.run((ctx) => ctx.db.get(fileId));
  const task = { id: fileId, key: row!.key, bucket: row!.bucket };
  await expect(
    f.t.action(internal.r2Storage.deleteObject, task),
  ).rejects.toThrow(/R2 unavailable/);
  expect(
    (await f.t.run((ctx) => ctx.db.query("storageCleanupRequests").first()))
      ?.state,
  ).toBe("pending");
  vi.mocked(r2.removeObject).mockResolvedValue(undefined);
  await f.t.action(internal.r2Storage.deleteObject, task);
  await f.t.action(internal.r2Storage.deleteObject, task);
  expect(vi.mocked(r2.removeObject)).toHaveBeenCalledTimes(2);
  expect(await f.t.run((ctx) => ctx.db.get(fileId))).toBeNull();
  expect(
    (await f.t.run((ctx) => ctx.db.query("storageCleanupRequests").first()))
      ?.state,
  ).toBe("completed");
});
it("does not delete a different R2 object when queued identity is wrong", async () => {
  const f = await fixture(),
    fileId = await f.orphan();
  await f.admin.mutation(api.adminMedia.cleanup, {
    fileId,
    reason: "Delete confirmed unreferenced file",
    requestId: "cleanup-1",
  });
  const remove = vi.spyOn(r2, "removeObject").mockResolvedValue(undefined);
  await expect(
    f.t.action(internal.r2Storage.deleteObject, {
      id: fileId,
      key: "another-file",
      bucket: "test-media",
    }),
  ).rejects.toThrow(/identity mismatch/);
  expect(remove).not.toHaveBeenCalled();
});
it("redacts storage keys and reports per-page eligibility without pretending to be a full total", async () => {
  const f = await fixture(),
    fileId = await f.orphan();
  const result = await f.ops.query(api.adminMedia.inventory, {
    paginationOpts: { cursor: null, numItems: 25 },
  });
  expect(result.page.find((row) => row.id === fileId)?.cleanupEligible).toBe(
    true,
  );
  expect(result.page.find((row) => row.id === f.fileId)?.cleanupEligible).toBe(
    false,
  );
  expect(JSON.stringify(result)).not.toContain("evidence-private-key");
});
it("supports legacy registered media holds and keeps previews separately audited", async () => {
  const f = await fixture(),
    storageId = await f.t.run((ctx) =>
      ctx.storage.store(new Blob(["legacy bytes"], { type: "image/png" })),
    );
  await f.user.mutation(api.storage.createAssetFromUpload, {
    projectId: f.projectId,
    storageId,
    type: "image",
    format: "image/png",
    name: "legacy.png",
  });
  await f.moderator.mutation(api.adminMedia.control, {
    ...f.controls,
    storageId,
  });
  expect(await f.t.query(internal.storageIO.url, { id: storageId })).toBeNull();
  const rows = await f.ops.query(api.adminMedia.inventory, {
    source: "convex",
    paginationOpts: { cursor: null, numItems: 25 },
  });
  expect(rows.page.some((row) => row.id === storageId)).toBe(true);
  const preview = await f.moderator.mutation(
    internal.adminMedia.previewContext,
    {
      storageId,
      reason: "Inspect quarantined evidence for review",
      requestId: "preview-1",
    },
  );
  expect(preview.url).toBeTruthy();
  expect(
    await f.t.run((ctx) =>
      ctx.db
        .query("auditLog")
        .filter((q) => q.eq(q.field("action"), "media.preview"))
        .collect(),
    ),
  ).toHaveLength(1);
});
it("rechecks captured generation inputs before paid submission after quarantine", async () => {
  const f = await fixture();
  await f.t.mutation(internal.billing.appendForTest, {
    workspaceId: f.workspaceId,
    userId: f.userId,
    delta: 2000000,
    reason: "grant",
  });
  const jobId = await f.t.mutation(internal.generation.createQueuedJob, {
    projectId: f.projectId,
    workspaceId: f.workspaceId,
    createdBy: f.userId,
    model: "seedance-2.5",
    modelVersion: "sume/seedance-2.5",
    kind: "text-to-video",
    prompt: "Use a reference",
    referenceAssetIds: [f.assetId],
    estimatedCostUsdMicros: 1000000,
  });
  await f.moderator.mutation(api.adminMedia.control, f.controls);
  expect(
    await f.t.mutation(internal.generation.beginSubmission, {
      jobId,
      attempt: 1,
    }),
  ).toBe("terminal");
  expect((await f.t.run((ctx) => ctx.db.get(jobId)))?.status).toBe("refunded");
});
it("requeues a failed cleanup once and refuses to duplicate active work", async () => {
  const f = await fixture(),
    fileId = await f.orphan();
  await f.admin.mutation(api.adminMedia.cleanup, {
    fileId,
    reason: "Delete confirmed abandoned media",
    requestId: "cleanup-1",
  });
  let request = await f.t.run((ctx) =>
    ctx.db.query("storageCleanupRequests").first(),
  );
  const args = {
    fileId,
    reason: "Retry a temporary storage deletion failure",
    requestId: "retry-1",
  };
  await expect(
    f.admin.mutation(api.adminMedia.retryCleanup, args),
  ).rejects.toThrow(/already queued/);
  await f.t.run((ctx) => ctx.db.patch(request!.taskId!, { state: "failed" }));
  await f.admin.mutation(api.adminMedia.retryCleanup, args);
  await f.admin.mutation(api.adminMedia.retryCleanup, args);
  request = await f.t.run((ctx) =>
    ctx.db.query("storageCleanupRequests").first(),
  );
  expect((await f.t.run((ctx) => ctx.db.get(request!.taskId!)))?.state).toBe(
    "pending",
  );
  expect(
    await f.t.run((ctx) =>
      ctx.db
        .query("apiTasks")
        .filter((q) => q.eq(q.field("operation"), "r2Storage:deleteObject"))
        .collect(),
    ),
  ).toHaveLength(1);
});
it("blocks newly admitted owner and shared export delivery after file quarantine", async () => {
  const f = await fixture();
  const publicationId = await f.t.run(async (ctx) => {
    const timelineFileId = await ctx.storage.store(
      new Blob(["{}"], { type: "application/json" }),
    );
    const versionId = await ctx.db.insert("timelineVersions", {
      projectId: f.projectId,
      timelineFileId,
      createdBy: f.userId,
      createdAt: Date.now(),
    });
    return ctx.db.insert("publishedExports", {
      workspaceId: f.workspaceId,
      projectId: f.projectId,
      versionId,
      createdBy: f.userId,
      requestId: "test-publication",
      title: "Stored export",
      state: "ready",
      reservedBytes: 100,
      expectedDurationSec: 1,
      expectedWidth: 1920,
      expectedHeight: 1080,
      storageId: f.fileId,
      sizeBytes: 100,
      createdAt: Date.now(),
      expiresAt: Date.now() + 86400000,
    });
  });
  const secretHash = "a".repeat(64),
    tokenHash = "b".repeat(64);
  const linkId = await f.user.mutation(internal.exportSharing.createHashed, {
    publicationId,
    secretHash,
    allowDownload: true,
  });
  await f.t.mutation(internal.exportSharing.openSession, {
    linkId,
    secretHash,
    tokenHash,
  });
  expect(
    await f.t.query(internal.exportSharing.authorizeViewer, {
      linkId,
      tokenHash,
      download: false,
    }),
  ).toBeTruthy();
  await f.moderator.mutation(api.adminMedia.control, f.controls);
  await expect(
    f.t.query(internal.exportSharing.authorizeViewer, {
      linkId,
      tokenHash,
      download: false,
    }),
  ).rejects.toThrow(/Share unavailable/);
  await expect(
    f.user.query(internal.publishedExports.getForDelivery, { publicationId }),
  ).rejects.toThrow(/quarantined/);
});
it("does not return private evidence through the legacy moderation queue", async () => {
  const f = await fixture();
  expect(
    JSON.stringify(await f.moderator.query(api.staff.listModerationQueue, {})),
  ).not.toContain("Private policy evidence");
});
