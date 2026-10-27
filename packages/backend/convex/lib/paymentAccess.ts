import { ConvexError } from "convex/values";
import { convexEnv } from "./env";
import type { Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";

export const paymentState = (
  ctx: QueryCtx | MutationCtx,
  workspaceId: Id<"workspaces">,
) =>
  ctx.db
    .query("paymentWorkspaces")
    .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
    .unique();

export async function occupiedSeats(
  ctx: QueryCtx | MutationCtx,
  workspaceId: Id<"workspaces">,
) {
  const members = await ctx.db
    .query("workspaceMembers")
    .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
    .collect();
  return 1 + members.filter((m) => m.role !== "reviewer").length;
}
export function subscriptionUsable(
  state: Awaited<ReturnType<typeof paymentState>>,
  now = Date.now(),
) {
  if (!state) return true; // Payment rollout begins only when this workspace enters checkout.
  if (state.reviewReason || !state.subscriptionId || state.paidSeats < 1)
    return false;
  if (state.status === "active")
    return state.paidPeriodEnd > now && state.periodEnd > now;
  if (state.status === "past_due")
    return (
      now <
      Math.min(state.paidPeriodEnd, state.pastDueAt ?? state.periodStart) +
        7 * 86400_000
    );
  return false;
}
export async function productionEntitlement(
  ctx: QueryCtx | MutationCtx,
  workspaceId: Id<"workspaces">,
) {
  const state = await paymentState(ctx, workspaceId);
  const denied = (code: string, message: string) => ({
    canWrite: false,
    code,
    message,
    validUntil: null as number | null,
  });
  if (!state)
    return convexEnv("SUBSCRIPTION_PAYWALL_ENABLED") === "true"
      ? denied(
          "SUBSCRIPTION_REQUIRED",
          "An active paid workspace subscription is required. The workspace owner can manage the Billing page.",
        )
      : { canWrite: true, code: null, message: null, validUntil: null };
  if (state.environment !== (convexEnv("POLAR_ENVIRONMENT") ?? "sandbox"))
    return denied(
      "PAYMENT_ENVIRONMENT_MISMATCH",
      "This workspace uses a different payment environment.",
    );
  if (!subscriptionUsable(state))
    return denied(
      "SUBSCRIPTION_REQUIRED",
      "An active paid workspace subscription is required. The workspace owner can manage the Billing page.",
    );
  if (
    (await occupiedSeats(ctx, workspaceId)) >
    Math.min(state.seats, state.paidSeats)
  )
    return denied(
      "PAID_SEATS_REQUIRED",
      "This workspace has more creators than paid seats. The owner must update Billing or remove unused seats.",
    );
  const validUntil =
    state.status === "past_due"
      ? Math.min(state.paidPeriodEnd, state.pastDueAt ?? state.periodStart) +
        7 * 86400_000
      : Math.min(state.paidPeriodEnd, state.periodEnd);
  return { canWrite: true, code: null, message: null, validUntil };
}
export async function assertPaymentProduction(
  ctx: QueryCtx | MutationCtx,
  workspaceId: Id<"workspaces">,
) {
  const status = await productionEntitlement(ctx, workspaceId);
  if (!status.canWrite)
    throw new ConvexError({ code: status.code!, message: status.message! });
}
export async function assertSeatAvailable(
  ctx: MutationCtx,
  workspaceId: Id<"workspaces">,
) {
  const state = await paymentState(ctx, workspaceId);
  await assertPaymentProduction(ctx, workspaceId);
  if (!state) return;
  const limit = Math.min(
    state.seats,
    state.paidSeats,
    state.pendingSeats ?? Infinity,
  );
  if ((await occupiedSeats(ctx, workspaceId)) >= limit)
    throw new Error(
      "No paid creator seat is available. Ask the owner to add a seat in Billing.",
    );
}
