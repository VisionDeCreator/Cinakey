import { v } from "convex/values";
import { action } from "../runtime/operation";
import { internal } from "../operations";
import { getAdapter } from "../providers";
/** A provider read only: never submit, collect, settle, refund, or enqueue work. */
export const checkProvider = action({
  args: { jobId: v.id("generationJobs") },
  handler: async (
    ctx,
    args,
  ): Promise<{
    status: "queued" | "running" | "succeeded" | "failed" | "unavailable";
  }> => {
    const context = await ctx.runMutation(
      internal.adminJobs.loadStatusContext,
      args,
    );
    let status: "queued" | "running" | "succeeded" | "failed" | "unavailable" =
      "unavailable";
    try {
      const adapter = getAdapter(context.model);
      if (adapter) status = (await adapter.poll(context.providerJobId)).status;
    } catch {
      /* Keep unknown outcomes separate from confirmed failure. */
    }
    await ctx.runMutation(internal.adminJobs.recordObservation, {
      jobId: context.jobId,
      jobVersion: context.jobVersion,
      providerJobId: context.providerJobId,
      modelVersion: context.modelVersion,
      checkedBy: context.checkedBy,
      status,
    });
    return { status };
  },
});
