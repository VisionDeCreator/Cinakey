import { afterEach, expect, it, vi } from "vitest";
import { api, internal } from "../../../apps/api/src/operations";
import {
  authIdentity,
  createFundedTestUser,
  createTestUser,
  makeTest,
} from "../test/helpers";
afterEach(() => vi.useRealTimers());
async function fixture() {
  const t = makeTest(),
    userId = await createFundedTestUser(t, "support-owner@test.com"),
    adminId = await createTestUser(t, "support-admin@test.com", {
      isStaff: true,
    }),
    supportId = await createTestUser(t, "support-agent@test.com", {
      isStaff: true,
    }),
    billingId = await createTestUser(t, "support-billing@test.com", {
      isStaff: true,
    });
  await t.run(async (ctx) => {
    await ctx.db.patch(supportId, { adminRoles: ["support"] });
    await ctx.db.patch(billingId, { adminRoles: ["billing"] });
  });
  const user = t.withIdentity(authIdentity(userId)),
    admin = t.withIdentity(authIdentity(adminId)),
    support = t.withIdentity(authIdentity(supportId)),
    billing = t.withIdentity(authIdentity(billingId));
  const workspaceId = await user.mutation(
      api.users.ensurePersonalWorkspace,
      {},
    ),
    projectId = await user.mutation(api.projects.create, {
      title: "Support test",
    });
  const target = { targetType: "user" as const, targetId: userId };
  const restrict = {
    ...target,
    control: "generation" as const,
    enabled: true,
    expectedRevision: 0,
    reason: "Investigate suspicious generation activity",
    requestId: "pause-1",
  };
  const createJob = () =>
    t.mutation(internal.generation.createQueuedJob, {
      workspaceId,
      projectId,
      createdBy: userId,
      model: "seedance-2.5",
      modelVersion: "sume/seedance-2.5",
      kind: "text-to-video",
      prompt: "Customer prompt",
      estimatedCostUsdMicros: 1000000,
    });
  return {
    t,
    user,
    admin,
    support,
    billing,
    userId,
    adminId,
    supportId,
    workspaceId,
    projectId,
    target,
    restrict,
    createJob,
  };
}
it("keeps support records private to authorized support staff", async () => {
  const f = await fixture();
  for (const client of [f.user, f.billing]) {
    await expect(
      client.query(api.adminSupport.detail, f.target),
    ).rejects.toThrow(/Staff/);
    await expect(
      client.query(api.adminSupport.notes, {
        ...f.target,
        paginationOpts: { cursor: null, numItems: 25 },
      }),
    ).rejects.toThrow(/Staff/);
    await expect(
      client.mutation(api.adminSupport.addNote, {
        ...f.target,
        reason: "Internal investigation note",
        requestId: "note-1",
      }),
    ).rejects.toThrow(/Staff/);
  }
  await expect(
    f.support.mutation(api.adminSupport.restrict, f.restrict),
  ).rejects.toThrow(/permission/);
});
it("records append-only notes once and rejects changed request replay", async () => {
  const f = await fixture(),
    args = {
      ...f.target,
      reason: "Investigated the customer report",
      requestId: "note-1",
    };
  await f.support.mutation(api.adminSupport.addNote, args);
  await f.support.mutation(api.adminSupport.addNote, args);
  const notes = await f.support.query(api.adminSupport.notes, {
    ...f.target,
    paginationOpts: { cursor: null, numItems: 1 },
  });
  expect(notes.page).toHaveLength(1);
  expect(notes.page[0]?.authorEmail).toBe("support-agent@test.com");
  await expect(
    f.support.mutation(api.adminSupport.addNote, {
      ...args,
      reason: "Changed investigation text",
    }),
  ).rejects.toThrow(/mismatch/);
  expect(
    JSON.stringify(await f.user.query(api.users.viewer, {})),
  ).not.toContain(args.reason);
  const audit = await f.t.run((ctx) =>
    ctx.db
      .query("auditLog")
      .filter((q) => q.eq(q.field("action"), "support.note"))
      .collect(),
  );
  expect(audit).toHaveLength(1);
  expect(audit[0]?.actorUserId).toBe(f.supportId);
  expect(JSON.stringify(audit)).not.toContain(args.reason);
});
it("creates, assigns, resolves and reopens cases with concurrency protection", async () => {
  const f = await fixture();
  const create = {
    ...f.target,
    subject: "Generation request issue",
    reason: "Customer reported a stalled job",
    requestId: "case-1",
  };
  await f.support.mutation(api.adminSupport.createCase, create);
  await f.support.mutation(api.adminSupport.createCase, create);
  const cases = await f.support.query(api.adminSupport.cases, {
    status: "open",
    paginationOpts: { cursor: null, numItems: 25 },
  });
  expect(cases.page).toHaveLength(1);
  const record = cases.page[0]!;
  const update = {
    caseId: record._id,
    status: "resolved" as const,
    assignedTo: f.supportId,
    expectedUpdatedAt: record.updatedAt,
    reason: "Confirmed provider recovery and resolution",
    requestId: "case-update-1",
  };
  await f.support.mutation(api.adminSupport.updateCase, update);
  await f.support.mutation(api.adminSupport.updateCase, update);
  await expect(
    f.support.mutation(api.adminSupport.updateCase, {
      ...update,
      status: "waiting",
      requestId: "case-update-2",
    }),
  ).rejects.toThrow(/Case changed/);
  const current = await f.t.run((ctx) => ctx.db.get(record._id));
  await f.support.mutation(api.adminSupport.updateCase, {
    ...update,
    status: "investigating",
    expectedUpdatedAt: current!.updatedAt,
    requestId: "case-reopen",
  });
  expect(
    (
      await f.support.query(api.adminSupport.cases, {
        status: "investigating",
        paginationOpts: { cursor: null, numItems: 25 },
      })
    ).page,
  ).toHaveLength(1);
});
it("rejects customer assignees and cross-target case notes", async () => {
  const f = await fixture();
  await f.support.mutation(api.adminSupport.createCase, {
    ...f.target,
    subject: "Test support case",
    reason: "Investigate customer issue",
    requestId: "case-1",
  });
  const c = (
    await f.support.query(api.adminSupport.cases, {
      status: "open",
      paginationOpts: { cursor: null, numItems: 25 },
    })
  ).page[0]!;
  await expect(
    f.support.mutation(api.adminSupport.updateCase, {
      caseId: c._id,
      status: "waiting",
      assignedTo: f.userId,
      expectedUpdatedAt: c.updatedAt,
      reason: "Assign for further investigation",
      requestId: "assign-1",
    }),
  ).rejects.toThrow(/active support administrator/);
  await expect(
    f.support.mutation(api.adminSupport.addNote, {
      targetType: "workspace",
      targetId: f.workspaceId,
      caseId: c._id,
      reason: "An unrelated workspace note",
      requestId: "note-1",
    }),
  ).rejects.toThrow(/Case target mismatch/);
});
it("pauses paid work without changing balances and restores access explicitly", async () => {
  const f = await fixture();
  const before = await f.user.query(api.billing.getBalance, {
    workspaceId: f.workspaceId,
  });
  await f.admin.mutation(api.adminSupport.restrict, f.restrict);
  await f.admin.mutation(api.adminSupport.restrict, f.restrict);
  await expect(f.createJob()).rejects.toThrow(/Generation is paused/);
  await expect(
    f.t.mutation(internal.textJobs.createChatJob, {
      projectId: f.projectId,
      workspaceId: f.workspaceId,
      userId: f.userId,
      estimatedCostUsdMicros: 1000,
      prompt: "Private analysis",
    }),
  ).rejects.toThrow(/Generation is paused/);
  expect(
    await f.user.query(api.billing.getBalance, { workspaceId: f.workspaceId }),
  ).toEqual(before);
  expect(
    await f.user.query(api.projects.get, { projectId: f.projectId }),
  ).toBeTruthy();
  await f.admin.mutation(api.adminSupport.restrict, {
    ...f.restrict,
    enabled: false,
    expectedRevision: 1,
    requestId: "unpause-1",
  });
  expect(await f.createJob()).toBeTruthy();
});
it("prevents stale or mismatched restriction requests and protects staff accounts", async () => {
  const f = await fixture();
  await f.admin.mutation(api.adminSupport.restrict, f.restrict);
  await expect(
    f.admin.mutation(api.adminSupport.restrict, {
      ...f.restrict,
      enabled: false,
    }),
  ).rejects.toThrow(/mismatch/);
  await expect(
    f.admin.mutation(api.adminSupport.restrict, {
      ...f.restrict,
      enabled: false,
      requestId: "stale",
    }),
  ).rejects.toThrow(/controls changed/);
  for (const targetId of [f.adminId, f.supportId])
    await expect(
      f.admin.mutation(api.adminSupport.restrict, {
        ...f.restrict,
        targetId,
        requestId: targetId,
      }),
    ).rejects.toThrow(/Administration/);
});
it("suspension blocks product reads and writes but exposes a generic viewer state", async () => {
  const f = await fixture();
  await f.admin.mutation(api.adminSupport.restrict, {
    ...f.restrict,
    control: "suspend",
  });
  expect(
    await f.user.query(api.projects.get, { projectId: f.projectId }),
  ).toBeNull();
  await expect(
    f.user.mutation(api.users.updateProfile, { name: "Changed" }),
  ).rejects.toThrow(/suspended/);
  expect((await f.user.query(api.users.viewer, {}))?.suspendedAt).toBeDefined();
  const detail = await f.support.query(api.adminSupport.detail, f.target);
  expect(detail?.type).toBe("user");
  await f.admin.mutation(api.adminSupport.restrict, {
    ...f.restrict,
    control: "suspend",
    enabled: false,
    expectedRevision: 1,
    requestId: "restore-1",
  });
  expect(
    await f.user.query(api.projects.get, { projectId: f.projectId }),
  ).toBeTruthy();
});
it("pauses workspace production even for company-funded workspaces while preserving reads", async () => {
  const f = await fixture();
  await f.t.run((ctx) =>
    ctx.db.patch(f.workspaceId, { billingMode: "internal" }),
  );
  await f.admin.mutation(api.adminSupport.restrict, {
    ...f.restrict,
    targetType: "workspace",
    targetId: f.workspaceId,
    control: "production",
  });
  expect(
    (
      await f.user.query(api.payments.entitlements, {
        workspaceId: f.workspaceId,
      })
    ).canWrite,
  ).toBe(false);
  await expect(
    f.user.mutation(api.projects.update, {
      projectId: f.projectId,
      title: "Blocked change",
    }),
  ).rejects.toThrow(/Production is paused/);
  await expect(f.createJob()).rejects.toThrow(/Production is paused/);
  expect(
    await f.user.query(api.projects.get, { projectId: f.projectId }),
  ).toBeTruthy();
});
it("cancels a proven unsubmitted queued job once after a restriction", async () => {
  const f = await fixture(),
    jobId = await f.createJob();
  await f.admin.mutation(api.adminSupport.restrict, f.restrict);
  expect(
    await f.t.mutation(internal.generation.beginSubmission, {
      jobId,
      attempt: 1,
    }),
  ).toBe("terminal");
  expect(
    await f.t.mutation(internal.generation.beginSubmission, {
      jobId,
      attempt: 1,
    }),
  ).toBe("terminal");
  expect((await f.t.run((ctx) => ctx.db.get(jobId)))?.status).toBe("refunded");
  const refunds = await f.t.run((ctx) =>
    ctx.db
      .query("usageLedger")
      .withIndex("by_job", (q) => q.eq("jobId", jobId))
      .filter((q) => q.eq(q.field("reason"), "refund"))
      .collect(),
  );
  expect(refunds).toHaveLength(1);
});
it("keeps accepted and ambiguous provider work reconcilable after restriction", async () => {
  const f = await fixture(),
    accepted = await f.createJob(),
    uncertain = await f.createJob();
  await f.t.mutation(internal.generation.markSubmitted, {
    jobId: accepted,
    providerJobId: "provider-123",
    attempts: 1,
  });
  await f.t.mutation(internal.generation.markSubmissionUncertain, {
    jobId: uncertain,
  });
  await f.admin.mutation(api.adminSupport.restrict, f.restrict);
  expect(
    await f.t.mutation(internal.generation.beginSubmission, {
      jobId: accepted,
      attempt: 2,
    }),
  ).toBe("resume");
  expect(
    await f.t.mutation(internal.generation.beginSubmission, {
      jobId: uncertain,
      attempt: 2,
    }),
  ).toBe("review");
  const rows = await f.t.run((ctx) =>
    ctx.db
      .query("usageLedger")
      .filter((q) => q.eq(q.field("reason"), "refund"))
      .collect(),
  );
  expect(rows).toHaveLength(0);
});
it("revokes old bearer sessions immediately while allowing a fresh login session", async () => {
  vi.useFakeTimers();
  const f = await fixture();
  const old = await f.t.run((ctx) =>
    ctx.db.insert("authSessions", {
      userId: f.userId,
      expirationTime: Date.now() + 86400000,
    }),
  );
  const oldUser = f.t.withIdentity({ subject: `${f.userId}|${old}` });
  expect(
    await oldUser.query(api.projects.get, { projectId: f.projectId }),
  ).toBeTruthy();
  await f.admin.mutation(api.adminSupport.restrict, {
    ...f.restrict,
    control: "revoke_sessions",
  });
  expect(
    await oldUser.query(api.projects.get, { projectId: f.projectId }),
  ).toBeNull();
  await expect(
    oldUser.mutation(api.users.updateProfile, { name: "Old session" }),
  ).rejects.toThrow(/Session revoked/);
  await f.t.mutation(internal.adminSupport.expireSessions, {
    userId: f.userId,
    before: Date.now(),
  });
  expect(
    (await f.t.run((ctx) => ctx.db.get(old)))?.expirationTime,
  ).toBeLessThanOrEqual(Date.now());
  vi.advanceTimersByTime(1000);
  const fresh = await f.t.run((ctx) =>
    ctx.db.insert("authSessions", {
      userId: f.userId,
      expirationTime: Date.now() + 86400000,
    }),
  );
  const freshUser = f.t.withIdentity({ subject: `${f.userId}|${fresh}` });
  expect(
    await freshUser.query(api.projects.get, { projectId: f.projectId }),
  ).toBeTruthy();
});
it("invalidates pre-issued upload sessions when workspace production is paused", async () => {
  const f = await fixture();
  const id = await f.user.mutation(internal.storageIO.beginR2Upload, {
    token: "upload-token",
    key: "file-key",
    projectId: f.projectId,
  });
  await f.admin.mutation(api.adminSupport.restrict, {
    ...f.restrict,
    targetType: "workspace",
    targetId: f.workspaceId,
    control: "production",
  });
  await expect(
    f.t.mutation(internal.storageIO.prepareR2Upload, {
      token: "upload-token",
      contentType: "video/mp4",
      size: 100,
    }),
  ).rejects.toThrow(/Upload access was restricted/);
  expect((await f.t.run((ctx) => ctx.db.get(id)))?.completing).not.toBe(true);
});
it("does not grant private project content or administrator roles through support tools", async () => {
  const f = await fixture();
  expect(
    await f.support.query(api.projects.get, { projectId: f.projectId }),
  ).toBeNull();
  await f.admin.mutation(api.adminSupport.restrict, {
    ...f.restrict,
    control: "suspend",
  });
  await expect(
    f.admin.mutation(api.adminAccess.setRoles, {
      email: "support-owner@test.com",
      roles: ["platform_admin"],
      reason: "Promote a suspended account",
      requestId: "promote-1",
    }),
  ).rejects.toThrow(/Restore this suspended account/);
});
it("preserves ambiguous legacy reservations after an account pause", async () => {
  const f = await fixture(),
    jobId = await f.createJob();
  await f.t.run((ctx) => ctx.db.patch(jobId, { submissionFenced: undefined }));
  await f.admin.mutation(api.adminSupport.restrict, f.restrict);
  expect(
    await f.t.mutation(internal.generation.beginSubmission, {
      jobId,
      attempt: 1,
    }),
  ).toBe("review");
  expect((await f.t.run((ctx) => ctx.db.get(jobId)))?.status).toBe("queued");
});
it("rejects production edits on a frozen workspace while allowing a read", async () => {
  const f = await fixture();
  await f.admin.mutation(api.adminSupport.restrict, {
    ...f.restrict,
    targetType: "workspace",
    targetId: f.workspaceId,
    control: "production",
  });
  await expect(
    f.user.mutation(api.projects.archive, { projectId: f.projectId }),
  ).rejects.toThrow(/Production is paused/);
  expect(
    await f.user.query(api.projects.get, { projectId: f.projectId }),
  ).toBeTruthy();
});
it("supports bounded session expiration without expiring sessions from a later login", async () => {
  vi.useFakeTimers();
  const f = await fixture();
  const before = Date.now();
  const old = await f.t.run(async (ctx) => {
    const ids = [];
    for (let i = 0; i < 101; i++)
      ids.push(
        await ctx.db.insert("authSessions", {
          userId: f.userId,
          expirationTime: before + 86400000,
        }),
      );
    return ids;
  });
  vi.advanceTimersByTime(1000);
  const fresh = await f.t.run((ctx) =>
    ctx.db.insert("authSessions", {
      userId: f.userId,
      expirationTime: Date.now() + 86400000,
    }),
  );
  await f.t.mutation(internal.adminSupport.expireSessions, {
    userId: f.userId,
    before,
  });
  await f.t.mutation(internal.adminSupport.expireSessions, {
    userId: f.userId,
    before,
  });
  const rows = await f.t.run(async (ctx) =>
    Promise.all(old.map((id) => ctx.db.get(id))),
  );
  expect(rows.every((s) => s!.expirationTime <= Date.now())).toBe(true);
  expect(
    (await f.t.run((ctx) => ctx.db.get(fresh)))!.expirationTime,
  ).toBeGreaterThan(Date.now());
});
