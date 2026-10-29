import { describe, expect, it } from "vitest";
import { createEmptyTimeline } from "@dirrio/shared";
import { api } from "../../../apps/api/src/operations";
import { makeTest, createTestUser, authIdentity } from "../test/helpers";

async function setup() {
  const t = makeTest();
  const userId = await createTestUser(t, "editor@example.com");
  const owner = t.withIdentity(authIdentity(userId));
  await owner.mutation(api.users.ensurePersonalWorkspace, {});
  const projectId = await owner.mutation(api.projects.create, {
    title: "Edit",
  });
  return { t, owner, userId, projectId };
}

describe("timeline editing leases", () => {
  it("fences displaced tabs, preserves idempotent saves and audits explicit takeover", async () => {
    const { t, owner, projectId } = await setup();
    const first = await owner.mutation(api.timelineLeases.claim, {
      projectId,
      sessionId: "tab-a",
    });
    if (!first.held) throw new Error("Expected lease");
    const request = {
      projectId,
      sessionId: "tab-a",
      fence: first.fence,
      parentId: null,
      requestId: "save-a",
      document: createEmptyTimeline({
        id: projectId,
        aspectRatio: "16:9",
        fps: 24,
      }),
    };
    const saved = await owner.action(api.timelineVersions.save, request);
    const blocked = await owner.mutation(api.timelineLeases.claim, {
      projectId,
      sessionId: "tab-b",
    });
    expect(blocked.held).toBe(false);
    expect("fence" in blocked).toBe(false);
    const next = await owner.mutation(api.timelineLeases.claim, {
      projectId,
      sessionId: "tab-b",
      takeover: true,
    });
    if (!next.held) throw new Error("Expected takeover");
    expect(next.fence).toBeGreaterThan(first.fence);
    await expect(
      owner.mutation(api.timelineLeases.renew, {
        projectId,
        sessionId: "tab-a",
        fence: first.fence,
      }),
    ).rejects.toThrow();
    await owner.mutation(api.timelineLeases.release, {
      projectId,
      sessionId: "tab-a",
      fence: first.fence,
    });
    await expect(
      owner.action(api.timelineVersions.save, {
        ...request,
        parentId: saved.versionId,
        requestId: "late",
      }),
    ).rejects.toThrow();
    expect(await owner.action(api.timelineVersions.save, request)).toEqual(
      saved,
    );
    await owner.mutation(api.timelineLeases.renew, {
      projectId,
      sessionId: "tab-b",
      fence: next.fence,
    });
    expect(
      await t.run((ctx) =>
        ctx.db
          .query("auditLog")
          .filter((q) => q.eq(q.field("action"), "timeline.editing_taken_over"))
          .collect(),
      ),
    ).toHaveLength(1);
  });

  it("denies Creator takeovers and rejects writes after assignment removal", async () => {
    const { t, owner, projectId } = await setup();
    const project = await owner.query(api.projects.get, { projectId });
    const creatorId = await createTestUser(t, "creator@example.com");
    const creator = t.withIdentity(authIdentity(creatorId));
    const assignmentId = await t.run(async (ctx) => {
      await ctx.db.insert("workspaceMembers", {
        workspaceId: project!.workspaceId,
        userId: creatorId,
        role: "creator",
        createdAt: Date.now(),
      });
      return ctx.db.insert("productionAssignments", {
        workspaceId: project!.workspaceId,
        userId: creatorId,
        projectId,
        manageReviews: false,
      });
    });
    const ownerLock = await owner.mutation(api.timelineLeases.claim, {
      projectId,
      sessionId: "owner",
    });
    if (!ownerLock.held) throw new Error("Expected lease");
    await expect(
      creator.mutation(api.timelineLeases.claim, {
        projectId,
        sessionId: "creator",
        takeover: true,
      }),
    ).rejects.toThrow("Only workspace Owners");
    await owner.mutation(api.timelineLeases.release, {
      projectId,
      sessionId: "owner",
      fence: ownerLock.fence,
    });
    const lock = await creator.mutation(api.timelineLeases.claim, {
      projectId,
      sessionId: "creator",
    });
    if (!lock.held) throw new Error("Expected lease");
    await t.run((ctx) => ctx.db.delete(assignmentId));
    await expect(
      creator.mutation(api.timelineLeases.renew, {
        projectId,
        sessionId: "creator",
        fence: lock.fence,
      }),
    ).rejects.toThrow("access denied");
    await expect(
      creator.action(api.timelineVersions.save, {
        projectId,
        sessionId: "creator",
        fence: lock.fence,
        requestId: "removed",
        parentId: null,
        document: createEmptyTimeline({
          id: projectId,
          aspectRatio: "16:9",
          fps: 24,
        }),
      }),
    ).rejects.toThrow("access denied");
  });

  it("expires abandoned sessions and rechecks production permissions", async () => {
    const { t, owner, projectId } = await setup();
    const first = await owner.mutation(api.timelineLeases.claim, {
      projectId,
      sessionId: "a",
    });
    if (!first.held) throw new Error("Expected lease");
    await t.run(async (ctx) => {
      const lease = await ctx.db.query("timelineLeases").first();
      await ctx.db.patch(lease!._id, { expiresAt: Date.now() - 1 });
    });
    await expect(
      owner.mutation(api.timelineLeases.renew, {
        projectId,
        sessionId: "a",
        fence: first.fence,
      }),
    ).rejects.toThrow();
    const replacement = await owner.mutation(api.timelineLeases.claim, {
      projectId,
      sessionId: "a",
    });
    expect(replacement.held && replacement.fence).toBe(first.fence + 1);
    const outsiderId = await createTestUser(t, "outsider@example.com");
    const outsider = t.withIdentity(authIdentity(outsiderId));
    await expect(
      outsider.mutation(api.timelineLeases.claim, {
        projectId,
        sessionId: "outside",
        takeover: true,
      }),
    ).rejects.toThrow("access denied");
  });
});
