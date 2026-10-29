import { afterEach, expect, it, vi } from "vitest";
import { api, internal } from "../../../apps/api/src/operations";
import {
  createFundedTestUser,
  createTestUser,
  authIdentity,
  makeTest,
} from "../test/helpers";
import * as providers from "../../../apps/api/src/providers";
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});
async function fixture() {
  const t = makeTest();
  const userId = await createFundedTestUser(t, "job-owner@test.com");
  const adminId = await createTestUser(t, "job-admin@test.com", {
      isStaff: true,
    }),
    supportId = await createTestUser(t, "job-support@test.com", {
      isStaff: true,
    }),
    opsId = await createTestUser(t, "job-ops@test.com", { isStaff: true });
  await t.run(async (ctx) => {
    await ctx.db.patch(supportId, { adminRoles: ["support"] });
    await ctx.db.patch(opsId, { adminRoles: ["operations"] });
  });
  const user = t.withIdentity(authIdentity(userId)),
    admin = t.withIdentity(authIdentity(adminId)),
    support = t.withIdentity(authIdentity(supportId)),
    ops = t.withIdentity(authIdentity(opsId));
  const projectId = await user.mutation(api.projects.create, {
    title: "Private customer project",
  });
  const workspaceId = (await user.query(api.projects.get, { projectId }))!
    .workspaceId;
  const inputsFileId = await t.run((ctx) =>
    ctx.storage.store(
      new Blob(
        [
          JSON.stringify({
            prompt: "Private customer prompt",
            kind: "text-to-video",
          }),
        ],
        { type: "application/json" },
      ),
    ),
  );
  const create = () =>
    t.mutation(internal.generation.createQueuedJob, {
      projectId,
      workspaceId,
      model: "seedance-2.5",
      modelVersion: "sume/seedance-2.5",
      kind: "text-to-video",
      prompt: "Private customer prompt",
      inputsFileId,
      estimatedCostUsdMicros: 1_000_000,
      createdBy: userId,
    });
  const jobId = await create();
  const request = {
    jobId,
    action: "cancel" as const,
    reason: "Cancel unsubmitted request",
    requestId: "cancel-1",
  };
  const accepted = async () => {
    await t.mutation(internal.generation.markSubmitted, {
      jobId,
      providerJobId: "provider-123",
      attempts: 1,
    });
    const task = await t.run((ctx) =>
      ctx.db
        .query("apiTasks")
        .withIndex("by_dedupe", (q) => q.eq("dedupeKey", `generation:${jobId}`))
        .unique(),
    );
    if (task) await t.run((ctx) => ctx.db.patch(task._id, { state: "failed" }));
  };
  const observe = async (
    status:
      "queued" | "running" | "succeeded" | "failed" | "unavailable" = "running",
  ) => {
    const { model: _, ...context } = await admin.mutation(
      internal.adminJobs.loadStatusContext,
      { jobId },
    );
    return t.mutation(internal.adminJobs.recordObservation, {
      ...context,
      status,
    });
  };

  return {
    t,
    user,
    admin,
    support,
    ops,
    userId,
    adminId,
    jobId,
    projectId,
    workspaceId,
    create,
    request,
    accepted,
    observe,
  };
}
it("permits metadata reads but excludes private prompts, storage, task args and financial data", async () => {
  const f = await fixture();
  const result = await f.support.query(api.adminJobs.detail, {
    jobId: f.jobId,
  });
  expect(result!.job.financial).toBeNull();
  expect(result!.job).not.toHaveProperty("prompt");
  expect(result!.tasks[0]).not.toHaveProperty("args");
  expect(JSON.stringify(result)).not.toContain("Private customer prompt");
  expect(JSON.stringify(result)).not.toContain("inputsFileId");
  await expect(
    f.support.mutation(api.adminJobs.readContent, {
      jobId: f.jobId,
      reason: "Inspect private input",
    }),
  ).rejects.toThrow("Staff access denied");
  await expect(
    f.user.query(api.adminJobs.detail, { jobId: f.jobId }),
  ).rejects.toThrow("Staff access required");
  expect(
    (await f.admin.query(api.adminJobs.detail, { jobId: f.jobId }))!.job
      .financial!.estimated,
  ).toBe(1_000_000);
  expect(
    await f.admin.mutation(api.adminJobs.readContent, {
      jobId: f.jobId,
      reason: "Investigate support case",
    }),
  ).toMatchObject({ prompt: "Private customer prompt" });
  expect(
    (await f.admin.query(api.staff.listAuditLog, {})).some(
      (row) => row.action === "jobs.content.read",
    ),
  ).toBe(true);
});
it("filters and paginates across jobs and backfills historical workspace IDs", async () => {
  const f = await fixture();
  await f.create();
  await f.create();
  const args = {
    paginationOpts: { cursor: null as string | null, numItems: 1 },
    user: "JOB-OWNER@test.com",
    status: "queued" as const,
    workspace: f.workspaceId,
    provider: "sume" as const,
  };
  const first = await f.support.query(api.adminJobs.list, args);
  const second = await f.support.query(api.adminJobs.list, {
    ...args,
    paginationOpts: { cursor: first.continueCursor, numItems: 1 },
  });
  expect(first.page).toHaveLength(1);
  expect(second.page).toHaveLength(1);
  expect(first.page[0]!._id).not.toBe(second.page[0]!._id);
  expect(
    (
      await f.support.query(api.adminJobs.list, {
        paginationOpts: { cursor: null, numItems: 25 },
        jobId: f.jobId,
      })
    ).page,
  ).toHaveLength(1);
  expect(
    (
      await f.support.query(api.adminJobs.list, {
        paginationOpts: { cursor: null, numItems: 25 },
        user: "missing@test.com",
      })
    ).page,
  ).toHaveLength(0);
  await f.t.run((ctx) => ctx.db.patch(f.jobId, { workspaceId: undefined }));
  await f.t.mutation(internal.adminJobs.backfillWorkspace, {
    paginationOpts: { cursor: null, numItems: 50 },
  });
  expect(
    (await f.admin.query(api.adminJobs.detail, { jobId: f.jobId }))!.job
      .workspaceId,
  ).toBe(f.workspaceId);
});
it("cancels only unsubmitted work and releases its reservation once across retries", async () => {
  const f = await fixture();
  await f.ops.mutation(api.adminJobs.recover, f.request);
  await f.ops.mutation(api.adminJobs.recover, f.request);
  expect((await f.user.query(api.billing.getBalance, {})).balance).toBe(
    5_000_000,
  );
  expect(
    (await f.user.query(api.generation.getJob, { jobId: f.jobId }))!.status,
  ).toBe("refunded");
  expect(
    await f.t.run((ctx) => ctx.db.query("apiTasks").collect()),
  ).toHaveLength(0);
  expect(
    (await f.admin.query(api.adminJobs.detail, {
      jobId: f.jobId,
    }))!.ledger.filter((row) => row.reason === "refund"),
  ).toHaveLength(1);
  await expect(
    f.ops.mutation(api.adminJobs.recover, { ...f.request, action: "review" }),
  ).rejects.toThrow("request mismatch");
});
it("does not cancel claimed, accepted or uncertain requests", async () => {
  const f = await fixture();
  await f.t.mutation(internal.tasks.claim, { owner: "worker", limit: 1 });
  await expect(
    f.ops.mutation(api.adminJobs.recover, f.request),
  ).rejects.toThrow("unsubmitted");
  await f.accepted();
  await f.t.mutation(internal.generation.markSubmissionUncertain, {
    jobId: f.jobId,
  });
  await expect(
    f.ops.mutation(api.adminJobs.recover, f.request),
  ).rejects.toThrow("unsubmitted");
  expect((await f.user.query(api.billing.getBalance, {})).balance).toBe(
    4_000_000,
  );
});
it("fences cancellation against concurrent worker claims", async () => {
  const f = await fixture();
  const result = await Promise.allSettled([
    f.ops.mutation(api.adminJobs.recover, f.request),
    f.t.mutation(internal.tasks.claim, { owner: "race", limit: 1 }),
  ]);
  const job = await f.t.query(internal.generation.getJobInternal, {
    jobId: f.jobId,
  });
  if (job!.status === "refunded") {
    expect(
      await f.t.run((ctx) => ctx.db.query("apiTasks").collect()),
    ).toHaveLength(0);
    expect(
      await f.t.mutation(internal.generation.beginSubmission, {
        jobId: f.jobId,
        attempt: 1,
      }),
    ).toBe("terminal");
  } else {
    expect(result[0]!.status).toBe("rejected");
    expect((await f.user.query(api.billing.getBalance, {})).balance).toBe(
      4_000_000,
    );
  }
});
it("requires fresh provider evidence before resuming tracking and permanently fences resubmission", async () => {
  vi.useFakeTimers();
  const f = await fixture();
  await f.accepted();
  await f.t.mutation(internal.generation.markSubmissionUncertain, {
    jobId: f.jobId,
  });
  const request = {
    ...f.request,
    action: "resume" as const,
    reason: "Resume confirmed accepted provider request",
  };
  await expect(f.ops.mutation(api.adminJobs.recover, request)).rejects.toThrow(
    "positive evidence",
  );
  await f.observe("unavailable");
  await expect(f.ops.mutation(api.adminJobs.recover, request)).rejects.toThrow(
    "positive evidence",
  );
  await f.observe("running");
  vi.advanceTimersByTime(301_000);
  await expect(f.ops.mutation(api.adminJobs.recover, request)).rejects.toThrow(
    "positive evidence",
  );
  await f.observe("running");
  await f.ops.mutation(api.adminJobs.recover, request);
  await f.ops.mutation(api.adminJobs.recover, request);
  const job = await f.t.query(internal.generation.getJobInternal, {
    jobId: f.jobId,
  });
  expect(job).toMatchObject({
    submissionState: "accepted",
    preventAutomaticResubmission: true,
    attempts: 1,
  });
  const tasks = await f.t.run((ctx) => ctx.db.query("apiTasks").collect());
  expect(tasks).toHaveLength(1);
  expect(tasks[0]!.operation).toBe("generation:pollJob");
  expect((await f.user.query(api.billing.getBalance, {})).balance).toBe(
    4_000_000,
  );
  expect(
    await f.t.mutation(internal.generation.beginSubmission, {
      jobId: f.jobId,
      attempt: 2,
    }),
  ).toBe("review");
});
it("checks provider state without submitting, collecting, settling or releasing funds", async () => {
  const f = await fixture();
  await f.accepted();
  const submit = vi.fn(),
    collect = vi.fn(),
    poll = vi.fn().mockResolvedValue({ status: "running" });
  vi.spyOn(providers, "getAdapter").mockReturnValue({
    poll,
    submit,
    collect,
  } as never);
  expect(
    await f.ops.action(api.adminJobs.checkProvider, { jobId: f.jobId }),
  ).toEqual({ status: "running" });
  expect(poll).toHaveBeenCalledWith("provider-123");
  expect(submit).not.toHaveBeenCalled();
  expect(collect).not.toHaveBeenCalled();
  expect((await f.user.query(api.billing.getBalance, {})).balance).toBe(
    4_000_000,
  );
  expect(
    (await f.admin.query(api.adminJobs.detail, { jobId: f.jobId }))!
      .observations[0]!.status,
  ).toBe("running");
  await expect(
    f.support.action(api.adminJobs.checkProvider, { jobId: f.jobId }),
  ).rejects.toThrow("Staff access denied");
});
it("holds funds when controlled tracking sees a provider failure, without a paid retry", async () => {
  const f = await fixture();
  await f.accepted();
  await f.observe();
  await f.ops.mutation(api.adminJobs.recover, {
    ...f.request,
    action: "resume",
  });
  const submit = vi.fn(),
    poll = vi
      .fn()
      .mockResolvedValue({ status: "failed", error: "temporary timeout" });
  vi.spyOn(providers, "getAdapter").mockReturnValue({
    poll,
    submit,
    isTransientError: () => true,
  } as never);
  await expect(
    f.t.action(internal.generation.pollJob, { jobId: f.jobId, pollAttempt: 0 }),
  ).rejects.toThrow("uncertain");
  expect(submit).not.toHaveBeenCalled();
  expect((await f.user.query(api.billing.getBalance, {})).balance).toBe(
    4_000_000,
  );
  expect(
    (await f.t.query(internal.generation.getJobInternal, { jobId: f.jobId }))!
      .submissionState,
  ).toBe("uncertain");
  await expect(
    f.t.action(internal.generation.submitAndTrack, {
      jobId: f.jobId,
      retry: true,
    }),
  ).rejects.toThrow("uncertain");
});
it("rejects provider evidence if job state changes during or after the check", async () => {
  const f = await fixture();
  await f.accepted();
  const { model: _, ...context } = await f.admin.mutation(
    internal.adminJobs.loadStatusContext,
    { jobId: f.jobId },
  );
  await f.t.mutation(internal.generation.markSubmissionUncertain, {
    jobId: f.jobId,
  });
  await expect(
    f.t.mutation(internal.adminJobs.recordObservation, {
      ...context,
      status: "running",
    }),
  ).rejects.toThrow("Job changed");
  await f.observe();
  await f.t.mutation(internal.generation.markRunning, { jobId: f.jobId });
  await expect(
    f.ops.mutation(api.adminJobs.recover, { ...f.request, action: "resume" }),
  ).rejects.toThrow("positive evidence");
});
it("records unavailable provider checks without interpreting them as failure or changing funds", async () => {
  const f = await fixture();
  await f.accepted();
  const submit = vi.fn();
  vi.spyOn(providers, "getAdapter").mockReturnValue({
    poll: vi.fn().mockRejectedValue(new Error("private supplier response")),
    submit,
  } as never);
  expect(
    await f.ops.action(api.adminJobs.checkProvider, { jobId: f.jobId }),
  ).toEqual({ status: "unavailable" });
  expect(submit).not.toHaveBeenCalled();
  expect((await f.user.query(api.billing.getBalance, {})).balance).toBe(
    4_000_000,
  );
  const data = await f.support.query(api.adminJobs.detail, { jobId: f.jobId });
  expect(JSON.stringify(data)).not.toContain("private supplier response");
});
it("records review evidence once without changing job state or billing", async () => {
  const f = await fixture();
  await expect(
    f.support.mutation(api.adminJobs.recover, {
      ...f.request,
      action: "review",
    }),
  ).rejects.toThrow("Staff access denied");
  const request = {
    ...f.request,
    action: "review" as const,
    reason: "Waiting for supplier case 123",
  };
  await f.ops.mutation(api.adminJobs.recover, request);
  await f.ops.mutation(api.adminJobs.recover, request);
  expect(
    (await f.admin.query(api.adminJobs.detail, { jobId: f.jobId }))!.reviews,
  ).toHaveLength(1);
  expect(
    (await f.support.query(api.adminJobs.detail, { jobId: f.jobId }))!.reviews,
  ).toHaveLength(0);
  expect((await f.user.query(api.billing.getBalance, {})).balance).toBe(
    4_000_000,
  );
  expect(
    (await f.t.query(internal.generation.getJobInternal, { jobId: f.jobId }))!
      .status,
  ).toBe("queued");
});
it("finds submission, billing, and stale-active attention cases without exposing prompts", async () => {
  const f = await fixture();
  await f.t.mutation(internal.generation.markSubmissionUncertain, {
    jobId: f.jobId,
  });
  const base = { paginationOpts: { cursor: null, numItems: 25 } };
  expect(
    (
      await f.support.query(api.adminJobs.list, {
        ...base,
        attention: "uncertain",
      })
    ).page,
  ).toHaveLength(1);
  expect(
    (
      await f.support.query(api.adminJobs.list, {
        ...base,
        attention: "stalled",
      })
    ).page,
  ).toHaveLength(0);
  await f.t.run((ctx) =>
    ctx.db.patch(f.jobId, {
      updatedAt: Date.now() - 960_000,
      billingNeedsReview: true,
    }),
  );
  const stale = await f.support.query(api.adminJobs.list, {
    ...base,
    attention: "stalled",
  });
  expect(stale.page[0]!.attention).toEqual(
    expect.arrayContaining(["uncertain", "stalled", "billing_review"]),
  );
  expect(
    (
      await f.support.query(api.adminJobs.list, {
        ...base,
        attention: "billing_review",
      })
    ).page,
  ).toHaveLength(1);
});
it("backfills historical workspace indexes across pages without dropping records", async () => {
  const f = await fixture();
  await f.t.run(async (ctx) => {
    const source = (await ctx.db.get(f.jobId))!;
    const { _id: _, _creationTime: __, ...template } = source;
    delete template.workspaceId;
    for (let i = 0; i < 60; i++)
      await ctx.db.insert("generationJobs", {
        ...template,
        createdAt: source.createdAt + i + 1,
      });
  });
  let cursor: string | null = null,
    updated = 0;
  for (let page = 0; page < 5; page++) {
    const result: { isDone: boolean; continueCursor: string; updated: number } =
      await f.t.mutation(internal.adminJobs.backfillWorkspace, {
        paginationOpts: { cursor, numItems: 50 },
      });
    updated += result.updated;
    if (result.isDone) break;
    cursor = result.continueCursor;
  }
  expect(updated).toBe(60);
  expect(
    await f.t.run((ctx) =>
      ctx.db
        .query("generationJobs")
        .withIndex("by_workspace_created", (q) =>
          q.eq("workspaceId", undefined),
        )
        .take(100),
    ),
  ).toHaveLength(0);
});
it("does not assume legacy queued jobs with incomplete submission history are safe to cancel", async () => {
  const f = await fixture();
  await f.t.run((ctx) =>
    ctx.db.patch(f.jobId, { submissionFenced: undefined }),
  );
  await expect(
    f.ops.mutation(api.adminJobs.recover, f.request),
  ).rejects.toThrow("unsubmitted");
  expect((await f.user.query(api.billing.getBalance, {})).balance).toBe(
    4_000_000,
  );
});
