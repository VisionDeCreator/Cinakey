/**
 * Generation job runner: estimate → reserve → submit → poll/webhook → settle/refund.
 */

import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import type { BuildRequestInput, GenerationAdapter } from "@cinakey/shared";
import { getAdapter, listAdapters } from "./adapters";
import { isDefaultTransientError } from "./adapters/cost";
import { appendLedgerEntry } from "./credits";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
  action,
  httpAction,
  internalAction,
  internalMutation,
  internalQuery,
  query,
  type ActionCtx,
} from "./_generated/server";
import { requireProjectAccess } from "./lib/access";
import { convexEnv } from "./lib/env";
import { loadJson, saveFile, saveJson } from "./storage";

const MAX_SUBMIT_ATTEMPTS = 3;
const POLL_BACKOFF_MS = [2000, 5000, 10000, 30000, 60000] as const;

function pollDelay(pollAttempt: number): number {
  const idx = Math.min(pollAttempt, POLL_BACKOFF_MS.length - 1);
  return POLL_BACKOFF_MS[idx]!;
}

// ---------------------------------------------------------------------------
// Public queries
// ---------------------------------------------------------------------------

export const listCapabilities = query({
  args: {},
  handler: async () => {
    return listAdapters().map((a) => a.capabilities);
  },
});

export const estimateCost = query({
  args: {
    adapterId: v.string(),
    kind: v.string(),
    input: v.any(),
  },
  handler: async (_ctx, args) => {
    const adapter = getAdapter(args.adapterId);
    if (!adapter) {
      throw new Error(`Unknown adapter: ${args.adapterId}`);
    }
    const input = {
      ...(args.input as BuildRequestInput),
      kind: args.kind,
    };
    return {
      credits: adapter.estimateCost(input),
      costModel: adapter.capabilities.costModel,
    };
  },
});

export const getJob = query({
  args: { jobId: v.id("generationJobs") },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (job === null) {
      return null;
    }
    await requireProjectAccess(ctx, job.projectId);
    return job;
  },
});

// ---------------------------------------------------------------------------
// Internal queries / mutations (job state machine)
// ---------------------------------------------------------------------------

export const getJobInternal = internalQuery({
  args: { jobId: v.id("generationJobs") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.jobId);
  },
});

export const getJobByProviderId = internalQuery({
  args: { providerJobId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("generationJobs")
      .withIndex("by_provider_job", (q) =>
        q.eq("providerJobId", args.providerJobId),
      )
      .first();
  },
});

export const loadStartContext = internalQuery({
  args: { projectId: v.id("projects"), userId: v.id("users") },
  handler: async (ctx, args) => {
    const user = await ctx.db.get(args.userId);
    if (user === null) {
      throw new Error("User not found");
    }
    const project = await ctx.db.get(args.projectId);
    if (project === null) {
      throw new Error("Project not found");
    }
    if (user.isStaff !== true) {
      const workspace = await ctx.db.get(project.workspaceId);
      if (workspace === null || workspace.ownerUserId !== user._id) {
        throw new Error("Project access denied");
      }
    }
    return { user, project };
  },
});

export const createQueuedJob = internalMutation({
  args: {
    projectId: v.id("projects"),
    workspaceId: v.id("workspaces"),
    shotId: v.optional(v.id("shots")),
    model: v.string(),
    modelVersion: v.string(),
    kind: v.string(),
    prompt: v.string(),
    seed: v.optional(v.number()),
    inputsFileId: v.optional(v.id("_storage")),
    estimatedCostCredits: v.number(),
    createdBy: v.id("users"),
    referenceAssetIds: v.optional(v.array(v.id("assets"))),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const jobId = await ctx.db.insert("generationJobs", {
      projectId: args.projectId,
      shotId: args.shotId,
      model: args.model,
      modelVersion: args.modelVersion,
      kind: args.kind,
      prompt: args.prompt,
      seed: args.seed,
      inputsFileId: args.inputsFileId,
      estimatedCostCredits: args.estimatedCostCredits,
      status: "queued",
      outputAssetIds: [],
      attempts: 0,
      createdBy: args.createdBy,
      createdAt: now,
      updatedAt: now,
    });

    try {
      await appendLedgerEntry(ctx, {
        workspaceId: args.workspaceId,
        userId: args.createdBy,
        projectId: args.projectId,
        jobId,
        delta: -args.estimatedCostCredits,
        reason: "reserve",
      });
    } catch (err) {
      await ctx.db.delete(jobId);
      throw err;
    }

    return jobId;
  },
});

export const markSubmitted = internalMutation({
  args: {
    jobId: v.id("generationJobs"),
    providerJobId: v.string(),
    attempts: v.number(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.jobId, {
      status: "submitted",
      providerJobId: args.providerJobId,
      attempts: args.attempts,
      updatedAt: Date.now(),
      errorMessage: undefined,
    });
  },
});

export const markRunning = internalMutation({
  args: { jobId: v.id("generationJobs") },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.jobId, {
      status: "running",
      updatedAt: Date.now(),
    });
  },
});

export const markSucceeded = internalMutation({
  args: {
    jobId: v.id("generationJobs"),
    outputAssetIds: v.array(v.id("assets")),
    actualCostCredits: v.number(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.jobId, {
      status: "succeeded",
      outputAssetIds: args.outputAssetIds,
      actualCostCredits: args.actualCostCredits,
      updatedAt: Date.now(),
      errorMessage: undefined,
    });
  },
});

export const markFailed = internalMutation({
  args: {
    jobId: v.id("generationJobs"),
    errorMessage: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.jobId, {
      status: "failed",
      errorMessage: args.errorMessage,
      updatedAt: Date.now(),
    });
  },
});

export const markRefunded = internalMutation({
  args: {
    jobId: v.id("generationJobs"),
    errorMessage: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.jobId, {
      status: "refunded",
      errorMessage: args.errorMessage,
      updatedAt: Date.now(),
    });
  },
});

export const bumpAttempts = internalMutation({
  args: { jobId: v.id("generationJobs"), attempts: v.number() },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.jobId, {
      attempts: args.attempts,
      updatedAt: Date.now(),
    });
  },
});

export const createTake = internalMutation({
  args: {
    projectId: v.id("projects"),
    shotId: v.id("shots"),
    assetId: v.id("assets"),
    jobId: v.id("generationJobs"),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("takes", {
      projectId: args.projectId,
      shotId: args.shotId,
      assetId: args.assetId,
      jobId: args.jobId,
      selected: false,
      createdAt: Date.now(),
    });
  },
});

// ---------------------------------------------------------------------------
// Public action: startGeneration
// ---------------------------------------------------------------------------

export const startGeneration = action({
  args: {
    projectId: v.id("projects"),
    adapterId: v.string(),
    kind: v.string(),
    prompt: v.string(),
    seed: v.optional(v.number()),
    shotId: v.optional(v.id("shots")),
    input: v.optional(v.any()),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{ jobId: Id<"generationJobs">; estimatedCostCredits: number }> => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) {
      throw new Error("Not authenticated");
    }

    const startCtx: { user: Doc<"users">; project: Doc<"projects"> } =
      await ctx.runQuery(internal.generation.loadStartContext, {
        projectId: args.projectId,
        userId,
      });
    const { user, project } = startCtx;

    const adapter = getAdapter(args.adapterId);
    if (!adapter) {
      throw new Error(`Unknown adapter: ${args.adapterId}`);
    }
    if (!adapter.capabilities.operations.includes(args.kind as never)) {
      throw new Error(
        `Adapter ${args.adapterId} does not support operation ${args.kind}`,
      );
    }

    const buildInput: BuildRequestInput = {
      ...(args.input as BuildRequestInput | undefined),
      prompt: args.prompt,
      kind: args.kind,
      seed: args.seed,
    };
    const estimated = adapter.estimateCost(buildInput);
    if (estimated <= 0) {
      throw new Error("Estimated cost must be positive");
    }

    // Persist inputs blob for lineage / debugging.
    const { storageId: inputsFileId } = await saveJson(ctx, buildInput);

    const jobId: Id<"generationJobs"> = await ctx.runMutation(
      internal.generation.createQueuedJob,
      {
        projectId: args.projectId,
        workspaceId: project.workspaceId,
        shotId: args.shotId,
        model: adapter.capabilities.id,
        modelVersion: adapter.capabilities.id,
        kind: args.kind,
        prompt: args.prompt,
        seed: args.seed,
        inputsFileId,
        estimatedCostCredits: estimated,
        createdBy: user._id,
      },
    );

    await ctx.scheduler.runAfter(0, internal.generation.submitAndTrack, {
      jobId,
    });

    return { jobId, estimatedCostCredits: estimated };
  },
});

// ---------------------------------------------------------------------------
// Internal actions: submit + poll
// ---------------------------------------------------------------------------

export const submitAndTrack = internalAction({
  args: { jobId: v.id("generationJobs") },
  handler: async (ctx, args) => {
    const job = await ctx.runQuery(internal.generation.getJobInternal, {
      jobId: args.jobId,
    });
    if (job === null) {
      return;
    }
    if (
      job.status === "succeeded" ||
      job.status === "refunded" ||
      job.status === "failed"
    ) {
      return;
    }

    const adapter = getAdapter(job.model);
    if (!adapter) {
      await failAndRefund(ctx, job, `Unknown adapter: ${job.model}`);
      return;
    }

    const attempt = job.attempts + 1;
    await ctx.runMutation(internal.generation.bumpAttempts, {
      jobId: job._id,
      attempts: attempt,
    });

    let buildInput: BuildRequestInput = {
      prompt: job.prompt,
      kind: job.kind,
      seed: job.seed,
    };
    if (job.inputsFileId) {
      try {
        const loaded = await loadJson<BuildRequestInput>(ctx, job.inputsFileId);
        buildInput = { ...loaded, ...buildInput };
      } catch {
        // proceed with minimal input
      }
    }

    try {
      const request = await adapter.buildRequest(buildInput);
      // Pass attempt for mock transient-retry tests.
      (request as Record<string, unknown>)._attempt = attempt;
      const result = await adapter.submit(request);

      await ctx.runMutation(internal.generation.markSubmitted, {
        jobId: job._id,
        providerJobId: result.providerJobId,
        attempts: attempt,
      });

      if (result.completedInline) {
        await ctx.scheduler.runAfter(0, internal.generation.pollJob, {
          jobId: job._id,
          pollAttempt: 0,
        });
      } else {
        await ctx.scheduler.runAfter(
          pollDelay(0),
          internal.generation.pollJob,
          { jobId: job._id, pollAttempt: 0 },
        );
      }
    } catch (err) {
      const transient =
        adapter.isTransientError?.(err) ?? isDefaultTransientError(err);
      if (transient && attempt < MAX_SUBMIT_ATTEMPTS) {
        await ctx.scheduler.runAfter(
          pollDelay(attempt - 1),
          internal.generation.submitAndTrack,
          { jobId: job._id },
        );
        return;
      }
      await failAndRefund(
        ctx,
        { ...job, attempts: attempt },
        err instanceof Error ? err.message : String(err),
      );
    }
  },
});

export const pollJob = internalAction({
  args: {
    jobId: v.id("generationJobs"),
    pollAttempt: v.number(),
  },
  handler: async (ctx, args) => {
    const job = await ctx.runQuery(internal.generation.getJobInternal, {
      jobId: args.jobId,
    });
    if (job === null) return;
    if (
      job.status === "succeeded" ||
      job.status === "refunded" ||
      job.status === "failed"
    ) {
      return;
    }
    if (!job.providerJobId) {
      await failAndRefund(ctx, job, "Missing providerJobId");
      return;
    }

    const adapter = getAdapter(job.model);
    if (!adapter) {
      await failAndRefund(ctx, job, `Unknown adapter: ${job.model}`);
      return;
    }

    try {
      const poll = await adapter.poll(job.providerJobId);

      if (poll.status === "queued" || poll.status === "running") {
        if (poll.status === "running" && job.status !== "running") {
          await ctx.runMutation(internal.generation.markRunning, {
            jobId: job._id,
          });
        }
        await ctx.scheduler.runAfter(
          pollDelay(args.pollAttempt),
          internal.generation.pollJob,
          { jobId: job._id, pollAttempt: args.pollAttempt + 1 },
        );
        return;
      }

      if (poll.status === "failed") {
        const transient =
          poll.error !== undefined &&
          (adapter.isTransientError?.(new Error(poll.error)) ??
            isDefaultTransientError(new Error(poll.error)));
        if (transient && job.attempts < MAX_SUBMIT_ATTEMPTS) {
          await ctx.scheduler.runAfter(
            pollDelay(job.attempts),
            internal.generation.submitAndTrack,
            { jobId: job._id },
          );
          return;
        }
        await failAndRefund(ctx, job, poll.error ?? "Provider failed");
        return;
      }

      // succeeded
      await finishSuccess(ctx, job, adapter, poll.actualUnits);
    } catch (err) {
      const transient =
        adapter.isTransientError?.(err) ?? isDefaultTransientError(err);
      if (transient && job.attempts < MAX_SUBMIT_ATTEMPTS) {
        await ctx.scheduler.runAfter(
          pollDelay(job.attempts),
          internal.generation.submitAndTrack,
          { jobId: job._id },
        );
        return;
      }
      await failAndRefund(
        ctx,
        job,
        err instanceof Error ? err.message : String(err),
      );
    }
  },
});

async function finishSuccess(
  ctx: ActionCtx,
  job: Doc<"generationJobs">,
  adapter: GenerationAdapter,
  actualUnits?: number,
) {
  if (!job.providerJobId) {
    throw new Error("Missing providerJobId");
  }
  const collected = await adapter.collect(job.providerJobId);
  const outputAssetIds: Id<"assets">[] = [];

  for (const out of collected.outputs) {
    let blob: Blob | null = null;
    let format = out.contentType ?? "application/octet-stream";

    if (out.base64) {
      const binary = atob(out.base64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
      }
      blob = new Blob([bytes], { type: format });
    } else if (out.url) {
      const res = await fetch(out.url);
      if (!res.ok) {
        throw new Error(`Failed to download output: ${res.status}`);
      }
      const buf = await res.arrayBuffer();
      format = res.headers.get("content-type") ?? format;
      blob = new Blob([buf], { type: format });
    } else if (out.type === "text") {
      const text = JSON.stringify(out.metadata ?? {});
      blob = new Blob([text], { type: "application/json" });
      format = "application/json";
    }

    if (blob === null) continue;

    const storageId = await saveFile(ctx, blob);
    const assetType =
      out.type === "image" ||
      out.type === "video" ||
      out.type === "audio" ||
      out.type === "json"
        ? out.type
        : out.type === "text"
          ? ("json" as const)
          : ("other" as const);

    const assetId = await ctx.runMutation(
      internal.storage.createAssetFromGeneration,
      {
        projectId: job.projectId,
        storageId,
        type: assetType,
        format,
        sizeBytes: blob.size,
        createdBy: job.createdBy,
        jobId: job._id,
        shotId: job.shotId,
        lineage: {
          prompt: job.prompt,
          model: job.model,
          modelVersion: job.modelVersion,
          seed: job.seed,
        },
      },
    );
    outputAssetIds.push(assetId);

    if (job.shotId) {
      await ctx.runMutation(internal.generation.createTake, {
        projectId: job.projectId,
        shotId: job.shotId,
        assetId,
        jobId: job._id,
      });
    }
  }

  const units =
    actualUnits ??
    (adapter.capabilities.kind === "video"
      ? 5
      : adapter.capabilities.kind === "llm"
        ? 1
        : 1);
  const actualCost = Math.min(
    job.estimatedCostCredits,
    Math.ceil(units * adapter.capabilities.costModel.creditsPerUnit),
  );

  const project = await ctx.runQuery(internal.generation.getProjectWorkspace, {
    projectId: job.projectId,
  });

  await ctx.runMutation(internal.credits.settle, {
    workspaceId: project.workspaceId,
    userId: job.createdBy,
    projectId: job.projectId,
    jobId: job._id,
    estimated: job.estimatedCostCredits,
    actual: actualCost,
  });

  await ctx.runMutation(internal.generation.markSucceeded, {
    jobId: job._id,
    outputAssetIds,
    actualCostCredits: actualCost,
  });

  await ctx.runMutation(internal.notifications.createForUser, {
    userId: job.createdBy,
    projectId: job.projectId,
    kind: "job_succeeded",
    title: `Generation succeeded (${job.model})`,
    body: job.prompt.slice(0, 120),
    href: `/dev/generation?jobId=${job._id}`,
  });
}

export const getProjectWorkspace = internalQuery({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    const project = await ctx.db.get(args.projectId);
    if (project === null) {
      throw new Error("Project not found");
    }
    return project;
  },
});

async function failAndRefund(
  ctx: ActionCtx,
  job: Doc<"generationJobs">,
  errorMessage: string,
) {
  await ctx.runMutation(internal.generation.markFailed, {
    jobId: job._id,
    errorMessage,
  });

  const project = await ctx.runQuery(internal.generation.getProjectWorkspace, {
    projectId: job.projectId,
  });

  await ctx.runMutation(internal.credits.refund, {
    workspaceId: project.workspaceId,
    userId: job.createdBy,
    projectId: job.projectId,
    jobId: job._id,
    amount: job.estimatedCostCredits,
  });

  await ctx.runMutation(internal.generation.markRefunded, {
    jobId: job._id,
    errorMessage,
  });

  await ctx.runMutation(internal.notifications.createForUser, {
    userId: job.createdBy,
    projectId: job.projectId,
    kind: "job_failed",
    title: `Generation failed (${job.model})`,
    body: errorMessage.slice(0, 200),
    href: `/dev/generation?jobId=${job._id}`,
  });
}

// ---------------------------------------------------------------------------
// Webhook HTTP handler (mounted from http.ts)
// ---------------------------------------------------------------------------

export const generationWebhook = httpAction(async (ctx, request) => {
  if (request.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const secret = convexEnv("GENERATION_WEBHOOK_SECRET");
  const body = await request.text();
  const signature =
    request.headers.get("x-cinakey-signature") ??
    request.headers.get("x-signature") ??
    "";

  if (!secret) {
    return new Response("Webhook secret not configured", { status: 503 });
  }

  const expected = await hmacSha256Hex(secret, body);
  if (!timingSafeEqual(signature, expected) && signature !== secret) {
    // Also allow raw secret match for simple local testing.
    return new Response("Invalid signature", { status: 401 });
  }

  let payload: {
    providerJobId?: string;
    status?: string;
    error?: string;
  };
  try {
    payload = JSON.parse(body) as typeof payload;
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  if (!payload.providerJobId) {
    return new Response("Missing providerJobId", { status: 400 });
  }

  const job = await ctx.runQuery(internal.generation.getJobByProviderId, {
    providerJobId: payload.providerJobId,
  });
  if (job === null) {
    return new Response("Job not found", { status: 404 });
  }

  // Kick the same poll path so settle/refund stays centralized.
  await ctx.scheduler.runAfter(0, internal.generation.pollJob, {
    jobId: job._id,
    pollAttempt: 0,
  });

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
});

async function hmacSha256Hex(secret: string, body: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(body));
  return [...new Uint8Array(sig)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) {
    out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return out === 0;
}
