import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
export async function recordJobEvent(
  ctx: MutationCtx,
  jobId: Id<"generationJobs">,
  event: string,
) {
  const last = await ctx.db
    .query("jobEvents")
    .withIndex("by_job_time", (q) => q.eq("jobId", jobId))
    .order("desc")
    .first();
  if (last?.event === event) return;
  await ctx.db.insert("jobEvents", { jobId, event, createdAt: Date.now() });
}
