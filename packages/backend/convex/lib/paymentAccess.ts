import { ConvexError } from "convex/values";
import { convexEnv } from "./env";
import type { Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";

export const TRIAL_DURATION_MS = 7 * 86400_000;

/** Enrollment can be disabled without revoking trials already promised. */
export async function trialAccess(
  ctx: QueryCtx | MutationCtx,
  workspaceId: Id<"workspaces">,
) {
  const workspace = await ctx.db.get(workspaceId);
  if (
    !workspace ||
    workspace.billingMode === "internal" ||
    workspace.productionPausedAt !== undefined
  )
    return { eligible: false, active: false, expiresAt: null, startedAt: null };
  const owner = await ctx.db.get(workspace.ownerUserId);
  const environment = convexEnv("POLAR_ENVIRONMENT") ?? "sandbox";
  const state = await paymentState(ctx, workspaceId);
  const eligibleState =
    !state?.subscriptionId &&
    !state?.reviewReason &&
    (!state || state.environment === environment);
  const sameOwner = workspace.trialOwnerId === workspace.ownerUserId;
  const active =
    (!state || !subscriptionUsable(state)) &&
    !!owner?.emailVerificationTime &&
    owner.suspendedAt === undefined &&
    sameOwner &&
    workspace.trialEnvironment === environment &&
    (workspace.trialExpiresAt ?? 0) > Date.now();
  const eligible =
    eligibleState &&
    convexEnv("WORKSPACE_TRIAL_ENABLED") === "true" &&
    !!owner?.emailVerificationTime &&
    owner.suspendedAt === undefined &&
    !owner.trialWorkspaceId &&
    workspace.trialStartedAt === undefined;
  return {
    eligible,
    active,
    expiresAt: workspace.trialExpiresAt ?? null,
    startedAt: workspace.trialStartedAt ?? null,
  };
}

export async function startProductionTrial(
  ctx: MutationCtx,
  workspaceId: Id<"workspaces">,
  userId: Id<"users">,
  generationOnly = false,
) {
  const workspace = await ctx.db.get(workspaceId);
  const trial = await trialAccess(ctx, workspaceId);
  const state = await paymentState(ctx, workspaceId);
  if (
    trial.eligible &&
    workspace?.ownerUserId === userId &&
    (!state || !subscriptionUsable(state)) &&
    !state?.reviewReason &&
    (!state ||
      state.environment === (convexEnv("POLAR_ENVIRONMENT") ?? "sandbox"))
  ) {
    if ((await occupiedSeats(ctx, workspaceId)) !== 1)
      throw new Error(
        "The trial includes one creator. Subscribe to add creators.",
      );
    const now = Date.now();
    await ctx.db.patch(userId, { trialWorkspaceId: workspaceId });
    await ctx.db.patch(workspaceId, {
      trialOwnerId: userId,
      trialStartedAt: now,
      trialExpiresAt: now + TRIAL_DURATION_MS,
      trialEnvironment: convexEnv("POLAR_ENVIRONMENT") ?? "sandbox",
    });
  }
  if (generationOnly) await assertPaymentGeneration(ctx, workspaceId);
  else await assertPaymentProduction(ctx, workspaceId);
}

export async function purchasedAvailable(
  ctx: QueryCtx | MutationCtx,
  workspaceId: Id<"workspaces">,
) {
  const pools = await ctx.db
    .query("fundingPools")
    .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
    .collect();
  return pools
    .filter(
      (p) =>
        p.kind === "purchased" &&
        !p.revoked &&
        (p.expiresAt === undefined || p.expiresAt > Date.now()),
    )
    .reduce((n, p) => n + p.remaining, 0);
}

/** Credit-funded generation access also authorizes the narrowly scoped preparation workflow. */
export async function assertPaymentGeneration(
  ctx: QueryCtx | MutationCtx,
  workspaceId: Id<"workspaces">,
  amount = 1,
) {
  const entitlement = await productionEntitlement(ctx, workspaceId);
  if (entitlement.canWrite) return;
  const workspace = await ctx.db.get(workspaceId);
  const state = await paymentState(ctx, workspaceId);
  if (
    workspace?.trialStartedAt !== undefined &&
    workspace.trialOwnerId === workspace.ownerUserId &&
    workspace.trialEnvironment ===
      (convexEnv("POLAR_ENVIRONMENT") ?? "sandbox") &&
    workspace.productionPausedAt === undefined &&
    !state?.reviewReason &&
    (!state ||
      state.environment === (convexEnv("POLAR_ENVIRONMENT") ?? "sandbox")) &&
    (await occupiedSeats(ctx, workspaceId)) === 1 &&
    (await purchasedAvailable(ctx, workspaceId)) >= amount
  )
    return;
  throw new ConvexError({
    code: entitlement.code ?? "SUBSCRIPTION_REQUIRED",
    message: entitlement.message ?? "Subscribe to continue production.",
  });
}

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
  if ((await ctx.db.get(workspaceId))?.productionPausedAt !== undefined)
    return {
      canWrite: false,
      code: "WORKSPACE_RESTRICTED",
      message: "Production is paused for this workspace. Contact support.",
      validUntil: null,
    };
  if ((await ctx.db.get(workspaceId))?.billingMode === "internal")
    return { canWrite: true, code: null, message: null, validUntil: null };
  const state = await paymentState(ctx, workspaceId);
  const denied = (code: string, message: string) => ({
    canWrite: false,
    code,
    message,
    validUntil: null as number | null,
  });
  if (
    (!state || !state.reviewReason) &&
    (!state ||
      state.environment === (convexEnv("POLAR_ENVIRONMENT") ?? "sandbox"))
  ) {
    const trial = await trialAccess(ctx, workspaceId);
    if (trial.active && (!state || !subscriptionUsable(state))) {
      if ((await occupiedSeats(ctx, workspaceId)) > 1)
        return denied(
          "PAID_SEATS_REQUIRED",
          "The trial includes one creator. Subscribe to add creators.",
        );
      return {
        canWrite: true,
        code: null,
        message: null,
        validUntil: trial.expiresAt,
      };
    }
    if (
      trial.startedAt !== null &&
      !trial.active &&
      (!state || !subscriptionUsable(state))
    )
      return denied(
        "TRIAL_EXPIRED",
        "Your trial has ended. Remaining purchased credits unlock projects, scripts, image/video reference uploads and generation. Subscribe for the full production workspace.",
      );
  }
  if (!state)
    return convexEnv("SUBSCRIPTION_PAYWALL_ENABLED") === "true" ||
      convexEnv("WORKSPACE_TRIAL_ENABLED") === "true"
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
  if ((await ctx.db.get(workspaceId))?.billingMode === "internal") return;
  const state = await paymentState(ctx, workspaceId);
  await assertPaymentProduction(ctx, workspaceId);
  const trial = await trialAccess(ctx, workspaceId);
  if (trial.active && (!state || !subscriptionUsable(state)))
    throw new Error(
      "The trial includes one creator. Subscribe to add creators.",
    );
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
