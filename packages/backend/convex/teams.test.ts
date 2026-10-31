import { FEATURES } from "@dirrio/shared";
import {
  beforeEach as beforeFeatureTest,
  afterEach as afterFeatureTest,
} from "vitest";
// Exercise the preserved implementation with the release switch enabled.
beforeFeatureTest(() => {
  FEATURES.remix = true;
});
afterFeatureTest(() => {
  FEATURES.remix = false;
});
import { describe, expect, it } from "vitest";
import { api, internal } from "../../../apps/api/src/operations";
import { authIdentity, createTestUser, makeTest } from "../test/helpers";

async function fixture() {
  const t = makeTest();
  const ownerId = await createTestUser(t, "owner@team.test");
  const creatorId = await createTestUser(t, "creator@team.test");
  const outsiderId = await createTestUser(t, "outsider@team.test");
  const owner = t.withIdentity(authIdentity(ownerId));
  const creator = t.withIdentity(authIdentity(creatorId));
  const outsider = t.withIdentity(authIdentity(outsiderId));
  const projectId = await owner.mutation(api.projects.create, {
    title: "Client film",
  });
  const project = await owner.query(api.projects.get, { projectId });
  const workspaceId = project!.workspaceId;
  return {
    t,
    ownerId,
    creatorId,
    outsiderId,
    owner,
    creator,
    outsider,
    projectId,
    workspaceId,
  };
}

async function join(
  f: Awaited<ReturnType<typeof fixture>>,
  role: "creator" | "reviewer" | "admin" = "creator",
) {
  const invitationId = await f.owner.mutation(api.teams.invite, {
    workspaceId: f.workspaceId,
    email: "Creator@team.test",
    role,
  });
  await f.creator.mutation(api.teams.accept, { invitationId });
  return invitationId;
}

describe("workspace teams", () => {
  it("binds invitations to verified email, accepts idempotently, and never grants an outsider access", async () => {
    const f = await fixture();
    const invitationId = await f.owner.mutation(api.teams.invite, {
      workspaceId: f.workspaceId,
      email: " CREATOR@team.test ",
      role: "creator",
    });
    await expect(
      f.outsider.mutation(api.teams.accept, { invitationId }),
    ).rejects.toThrow("Invitation access denied");
    await f.t.run((ctx) =>
      ctx.db.patch(f.creatorId, { emailVerificationTime: undefined }),
    );
    await expect(
      f.creator.mutation(api.teams.accept, { invitationId }),
    ).rejects.toThrow("verify");
    await f.t.run((ctx) =>
      ctx.db.patch(f.creatorId, { emailVerificationTime: Date.now() }),
    );
    await f.creator.mutation(api.teams.accept, { invitationId });
    await f.creator.mutation(api.teams.accept, { invitationId });
    const members = await f.owner.query(api.teams.members, {
      workspaceId: f.workspaceId,
    });
    expect(members.filter((m) => m.userId === f.creatorId)).toHaveLength(1);
    expect(
      await f.outsider.query(api.projects.get, { projectId: f.projectId }),
    ).toBeNull();
  });

  it("requires creator assignments, shares scripts, and revokes production access immediately", async () => {
    const f = await fixture();
    await join(f);
    expect(
      await f.creator.query(api.projects.get, { projectId: f.projectId }),
    ).toBeNull();
    await f.owner.mutation(api.teams.assign, {
      workspaceId: f.workspaceId,
      userId: f.creatorId,
      projectId: f.projectId,
      enabled: true,
    });
    expect(
      (await f.creator.query(api.projects.listMine, {})).map(
        (p) => p.project._id,
      ),
    ).toContain(f.projectId);
    await f.creator.action(api.workspace.ensure, { projectId: f.projectId });
    const script = await f.creator.action(api.workspace.script, {
      projectId: f.projectId,
    });
    await f.creator.mutation(api.workspace.saveScript, {
      projectId: f.projectId,
      expectedId: script.id,
      text: "Team revision",
    });
    expect(
      (await f.owner.action(api.workspace.script, { projectId: f.projectId }))
        .text,
    ).toBe("Team revision");
    await f.owner.mutation(api.teams.changeMember, {
      workspaceId: f.workspaceId,
      userId: f.creatorId,
      role: "remove",
    });
    await expect(
      f.creator.action(api.workspace.script, { projectId: f.projectId }),
    ).rejects.toThrow("Project access denied");
    expect(await f.creator.query(api.projects.listMine, {})).toEqual([]);
    expect(
      await f.owner.query(api.teams.assignments, {
        workspaceId: f.workspaceId,
        userId: f.creatorId,
      }),
    ).toEqual([]);
  });

  it("prevents creators and reviewers from administering membership or raising budgets", async () => {
    const f = await fixture();
    await join(f);
    await f.owner.mutation(api.teams.assign, {
      workspaceId: f.workspaceId,
      userId: f.creatorId,
      projectId: f.projectId,
      enabled: true,
    });
    await expect(
      f.creator.mutation(api.projects.update, {
        projectId: f.projectId,
        spendCapUsdMicros: 9999,
      }),
    ).rejects.toThrow("Workspace access denied");
    await expect(
      f.creator.mutation(api.teams.invite, {
        workspaceId: f.workspaceId,
        email: "other@team.test",
        role: "admin",
      }),
    ).rejects.toThrow("Workspace access denied");
    await f.owner.mutation(api.teams.changeMember, {
      workspaceId: f.workspaceId,
      userId: f.creatorId,
      role: "reviewer",
    });
    expect(
      await f.creator.query(api.projects.get, { projectId: f.projectId }),
    ).toBeNull();
    await expect(
      f.creator.query(api.teams.members, { workspaceId: f.workspaceId }),
    ).rejects.toThrow("Workspace access denied");
  });

  it("inherits series assignments without exposing sibling episodes to episode-only creators", async () => {
    const f = await fixture();
    await join(f);
    const seriesId = await f.owner.mutation(api.series.create, {
      title: "Campaign",
    });
    const [a, b] = await f.t.run(async (ctx) => {
      const base = {
        workspaceId: f.workspaceId,
        seriesId,
        title: "Episode",
        aspectRatio: "16:9" as const,
        fps: 24,
        rules: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      return [
        await ctx.db.insert("projects", { ...base, episodeNumber: 1 }),
        await ctx.db.insert("projects", { ...base, episodeNumber: 2 }),
      ];
    });
    await f.owner.mutation(api.teams.assign, {
      workspaceId: f.workspaceId,
      userId: f.creatorId,
      projectId: a,
      enabled: true,
    });
    expect(
      await f.creator.query(api.projects.get, { projectId: a }),
    ).not.toBeNull();
    expect(
      await f.creator.query(api.projects.get, { projectId: b }),
    ).toBeNull();
    await f.owner.mutation(api.teams.assign, {
      workspaceId: f.workspaceId,
      userId: f.creatorId,
      seriesId,
      enabled: true,
    });
    expect(
      await f.creator.query(api.projects.get, { projectId: b }),
    ).not.toBeNull();
  });

  it("rejects revoked/expired invitations and cross-workspace assignments", async () => {
    const f = await fixture();
    const invitationId = await f.owner.mutation(api.teams.invite, {
      workspaceId: f.workspaceId,
      email: "creator@team.test",
      role: "creator",
    });
    await f.owner.mutation(api.teams.revoke, { invitationId });
    await expect(
      f.creator.mutation(api.teams.accept, { invitationId }),
    ).rejects.toThrow("no longer available");
    const expired = await f.owner.mutation(api.teams.invite, {
      workspaceId: f.workspaceId,
      email: "creator@team.test",
      role: "creator",
    });
    await f.t.run((ctx) =>
      ctx.db.patch(expired, { expiresAt: Date.now() - 1 }),
    );
    await expect(
      f.creator.mutation(api.teams.accept, { invitationId: expired }),
    ).rejects.toThrow("no longer available");
    await join(f);
    const otherProject = await f.outsider.mutation(api.projects.create, {
      title: "Private",
    });
    await expect(
      f.owner.mutation(api.teams.assign, {
        workspaceId: f.workspaceId,
        userId: f.creatorId,
        projectId: otherProject,
        enabled: true,
      }),
    ).rejects.toThrow("mismatch");
  });

  it("allows creator-owned new productions in the team without granting workspace administration", async () => {
    const f = await fixture();
    await join(f);
    const id = await f.creator.mutation(api.projects.create, {
      workspaceId: f.workspaceId,
      title: "New team film",
    });
    expect(
      await f.creator.query(api.projects.get, { projectId: id }),
    ).not.toBeNull();
    expect(
      await f.owner.query(api.projects.get, { projectId: id }),
    ).not.toBeNull();
    await expect(
      f.creator.query(api.teams.pending, { workspaceId: f.workspaceId }),
    ).rejects.toThrow("Workspace access denied");
  });

  it("rechecks access at paid-job admission after membership is removed", async () => {
    const f = await fixture();
    await join(f);
    await f.owner.mutation(api.teams.assign, {
      workspaceId: f.workspaceId,
      userId: f.creatorId,
      projectId: f.projectId,
      enabled: true,
    });
    await f.owner.mutation(api.teams.changeMember, {
      workspaceId: f.workspaceId,
      userId: f.creatorId,
      role: "remove",
    });
    await expect(
      f.t.mutation(internal.textJobs.createChatJob, {
        projectId: f.projectId,
        workspaceId: f.workspaceId,
        userId: f.creatorId,
        estimatedCostUsdMicros: 2,
        prompt: "stale request",
      }),
    ).rejects.toThrow("Project access denied");
  });

  it("blocks owner account purge while collaborators remain", async () => {
    const f = await fixture();
    await join(f, "admin");
    await expect(
      f.owner.mutation(api.users.deleteAccount, { confirm: "DELETE" }),
    ).rejects.toThrow("Remove workspace members");
    await expect(
      f.creator.mutation(api.teams.changeMember, {
        workspaceId: f.workspaceId,
        userId: f.ownerId,
        role: "remove",
      }),
    ).rejects.toThrow("owner");
  });
  it("limits asset URLs to assigned productions even inside the same workspace", async () => {
    const f = await fixture();
    await join(f);
    const siblingId = await f.owner.mutation(api.projects.create, {
      title: "Other client",
    });
    const storageId = await f.t.run((ctx) =>
      ctx.storage.store(new Blob(["image"], { type: "image/png" })),
    );
    const assetId = await f.owner.mutation(api.storage.createAssetFromUpload, {
      projectId: siblingId,
      storageId,
      type: "image",
      name: "private.png",
    });
    await f.owner.mutation(api.teams.assign, {
      workspaceId: f.workspaceId,
      userId: f.creatorId,
      projectId: f.projectId,
      enabled: true,
    });
    await expect(
      f.creator.query(api.storage.getAssetUrl, { assetId }),
    ).rejects.toThrow("access denied");
    await f.owner.mutation(api.teams.assign, {
      workspaceId: f.workspaceId,
      userId: f.creatorId,
      projectId: siblingId,
      enabled: true,
    });
    expect(
      await f.creator.query(api.storage.getAssetUrl, { assetId }),
    ).toBeTruthy();
  });

  it("removes a departing member's access without purging the owner's production", async () => {
    const f = await fixture();
    await join(f);
    await f.owner.mutation(api.teams.assign, {
      workspaceId: f.workspaceId,
      userId: f.creatorId,
      projectId: f.projectId,
      enabled: true,
    });
    await f.t.mutation(internal.users.purgeUserData, { userId: f.creatorId });
    expect(
      await f.owner.query(api.projects.get, { projectId: f.projectId }),
    ).not.toBeNull();
    expect(
      (
        await f.owner.query(api.teams.members, { workspaceId: f.workspaceId })
      ).some((m) => m.userId === f.creatorId),
    ).toBe(false);
    expect(
      await f.owner.query(api.teams.assignments, {
        workspaceId: f.workspaceId,
        userId: f.creatorId,
      }),
    ).toEqual([]);
  });
});

describe("workspace context and ownership", () => {
  it("scopes projects and assets to the selected workspace and rejects nonmembers", async () => {
    const f = await fixture();
    await join(f);
    const personal = await f.creator.mutation(api.projects.create, {
      title: "Personal film",
    });
    await f.owner.mutation(api.teams.assign, {
      workspaceId: f.workspaceId,
      userId: f.creatorId,
      projectId: f.projectId,
      enabled: true,
    });
    const rows = await f.creator.query(api.projects.listMine, {
      workspaceId: f.workspaceId,
    });
    expect(rows.map((r) => r.project._id)).toEqual([f.projectId]);
    expect(rows.some((r) => r.project._id === personal)).toBe(false);
    await expect(
      f.outsider.query(api.projects.listMine, { workspaceId: f.workspaceId }),
    ).rejects.toThrow("Workspace access denied");
    await expect(
      f.outsider.query(api.assets.list, { workspaceId: f.workspaceId }),
    ).rejects.toThrow("Workspace access denied");
    const sibling = await f.owner.mutation(api.projects.create, {
      title: "Other client",
    });
    const storageId = await f.t.run((ctx) =>
      ctx.storage.store(new Blob(["private"], { type: "image/png" })),
    );
    await f.owner.mutation(api.storage.createAssetFromUpload, {
      projectId: sibling,
      storageId,
      type: "image",
      name: "hidden.png",
    });
    expect(
      await f.creator.query(api.assets.list, { workspaceId: f.workspaceId }),
    ).toEqual([]);
    expect(
      await f.creator.query(api.assets.filterOptions, {
        workspaceId: f.workspaceId,
      }),
    ).toEqual({ characters: [], tags: [] });
  });

  it("creates series and transformation sessions in the explicit workspace with role checks", async () => {
    const f = await fixture();
    await join(f);
    await expect(
      f.creator.mutation(api.series.create, {
        title: "Denied series",
        workspaceId: f.workspaceId,
      }),
    ).rejects.toThrow("Workspace access denied");
    const seriesId = await f.owner.mutation(api.series.create, {
      title: "Shared campaign",
      workspaceId: f.workspaceId,
    });
    expect(
      (
        await f.owner.query(api.series.list, { workspaceId: f.workspaceId })
      ).map((s) => s._id),
    ).toEqual([seriesId]);
    const sessionId = await f.creator.mutation(api.genjutsu.create, {
      title: "Team transformation",
      workspaceId: f.workspaceId,
    });
    expect(
      (
        await f.creator.query(api.genjutsu.list, { workspaceId: f.workspaceId })
      ).map((s) => s._id),
    ).toEqual([sessionId]);
    expect(
      await f.outsider.query(api.teams.routeWorkspace, { sessionId }),
    ).toBeNull();
    await f.owner.mutation(api.teams.changeMember, {
      workspaceId: f.workspaceId,
      userId: f.creatorId,
      role: "reviewer",
    });
    expect(
      await f.creator.query(api.genjutsu.list, { workspaceId: f.workspaceId }),
    ).toEqual([]);
    await expect(
      f.creator.mutation(api.genjutsu.create, {
        title: "Denied",
        workspaceId: f.workspaceId,
      }),
    ).rejects.toThrow("Workspace access denied");
  });

  it("keeps workspace balances and ledger history private to owners and admins", async () => {
    const f = await fixture();
    await join(f);
    await expect(
      f.creator.query(api.billing.getBalance, { workspaceId: f.workspaceId }),
    ).rejects.toThrow("Workspace access denied");
    await expect(
      f.creator.query(api.billing.listLedger, { workspaceId: f.workspaceId }),
    ).rejects.toThrow("Workspace access denied");
    await f.owner.mutation(api.teams.changeMember, {
      workspaceId: f.workspaceId,
      userId: f.creatorId,
      role: "admin",
    });
    expect(
      (
        await f.creator.query(api.billing.getBalance, {
          workspaceId: f.workspaceId,
        })
      ).workspaceId,
    ).toBe(f.workspaceId);
  });

  it("transfers ownership atomically and preserves the former owner's admin access", async () => {
    const f = await fixture();
    await join(f);
    await expect(
      f.creator.mutation(api.teams.transferOwnership, {
        workspaceId: f.workspaceId,
        newOwnerId: f.ownerId,
      }),
    ).rejects.toThrow("Only the workspace owner");
    await f.owner.mutation(api.teams.transferOwnership, {
      workspaceId: f.workspaceId,
      newOwnerId: f.creatorId,
    });
    const members = await f.creator.query(api.teams.members, {
      workspaceId: f.workspaceId,
    });
    expect(
      members.filter((m) => m.role === "owner").map((m) => m.userId),
    ).toEqual([f.creatorId]);
    expect(members.find((m) => m.userId === f.ownerId)?.role).toBe("admin");
    expect(
      await f.owner.query(api.projects.get, { projectId: f.projectId }),
    ).not.toBeNull();
    const personal = await f.owner.mutation(
      api.users.ensurePersonalWorkspace,
      {},
    );
    expect(personal).not.toBe(f.workspaceId);
    await expect(
      f.owner.mutation(api.teams.transferOwnership, {
        workspaceId: f.workspaceId,
        newOwnerId: f.ownerId,
      }),
    ).rejects.toThrow("Only the workspace owner");
    await f.creator.mutation(api.teams.changeMember, {
      workspaceId: f.workspaceId,
      userId: f.ownerId,
      role: "remove",
    });
    await f.t.mutation(internal.users.purgeUserData, { userId: f.ownerId });
    expect(
      await f.creator.query(api.projects.get, { projectId: f.projectId }),
    ).not.toBeNull();
  });

  it("rejects ownership transfer to reviewers, outsiders, or unverified members", async () => {
    const f = await fixture();
    await join(f, "reviewer");
    await expect(
      f.owner.mutation(api.teams.transferOwnership, {
        workspaceId: f.workspaceId,
        newOwnerId: f.creatorId,
      }),
    ).rejects.toThrow("verified active");
    await expect(
      f.owner.mutation(api.teams.transferOwnership, {
        workspaceId: f.workspaceId,
        newOwnerId: f.outsiderId,
      }),
    ).rejects.toThrow("verified active");
    await f.owner.mutation(api.teams.changeMember, {
      workspaceId: f.workspaceId,
      userId: f.creatorId,
      role: "admin",
    });
    await f.t.run((ctx) =>
      ctx.db.patch(f.creatorId, { emailVerificationTime: undefined }),
    );
    await expect(
      f.owner.mutation(api.teams.transferOwnership, {
        workspaceId: f.workspaceId,
        newOwnerId: f.creatorId,
      }),
    ).rejects.toThrow("verified active");
  });

  it("purges every owned workspace on account deletion without leaving orphaned owners", async () => {
    const f = await fixture();
    await join(f);
    const own = await f.creator.mutation(api.projects.create, {
      title: "Personal",
    });
    await f.owner.mutation(api.teams.transferOwnership, {
      workspaceId: f.workspaceId,
      newOwnerId: f.creatorId,
    });
    await f.creator.mutation(api.teams.changeMember, {
      workspaceId: f.workspaceId,
      userId: f.ownerId,
      role: "remove",
    });
    await f.t.mutation(internal.users.purgeUserData, { userId: f.creatorId });
    const remaining = await f.t.run((ctx) =>
      ctx.db
        .query("workspaces")
        .withIndex("by_owner", (q) => q.eq("ownerUserId", f.creatorId))
        .collect(),
    );
    expect(remaining).toEqual([]);
    expect(await f.t.run((ctx) => ctx.db.get(own))).toBeNull();
    expect(await f.t.run((ctx) => ctx.db.get(f.projectId))).toBeNull();
  });
});

it("reports only project access and preserves inherited series access when a direct grant is removed", async () => {
  const f = await fixture();
  await join(f);
  const seriesId = await f.owner.mutation(api.series.create, {
    workspaceId: f.workspaceId,
    title: "Season",
  });
  await f.t.run((ctx) => ctx.db.patch(f.projectId, { seriesId }));
  await f.owner.mutation(api.teams.assign, {
    workspaceId: f.workspaceId,
    userId: f.creatorId,
    seriesId,
    enabled: true,
  });
  await f.owner.mutation(api.teams.assign, {
    workspaceId: f.workspaceId,
    userId: f.creatorId,
    projectId: f.projectId,
    enabled: true,
  });
  let members = await f.owner.query(api.teams.projectAccess, {
    projectId: f.projectId,
  });
  expect(members.find((m) => m.userId === f.creatorId)).toMatchObject({
    direct: true,
    inherited: true,
    automatic: false,
  });
  expect(members.find((m) => m.userId === f.ownerId)).toMatchObject({
    automatic: true,
  });
  await f.owner.mutation(api.teams.assign, {
    workspaceId: f.workspaceId,
    userId: f.creatorId,
    projectId: f.projectId,
    enabled: false,
  });
  members = await f.owner.query(api.teams.projectAccess, {
    projectId: f.projectId,
  });
  expect(members.find((m) => m.userId === f.creatorId)).toMatchObject({
    direct: false,
    inherited: true,
  });
  expect(
    await f.creator.query(api.projects.get, { projectId: f.projectId }),
  ).not.toBeNull();
  await expect(
    f.creator.query(api.teams.projectAccess, { projectId: f.projectId }),
  ).rejects.toThrow();
  await expect(
    f.outsider.query(api.teams.projectAccess, { projectId: f.projectId }),
  ).rejects.toThrow();
  expect(members.some((m) => m.userId === f.outsiderId)).toBe(false);
});
