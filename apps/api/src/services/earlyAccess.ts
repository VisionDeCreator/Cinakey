import { approvalEmail } from "./waitlistEmail";
import { v } from "convex/values";
import { internalAction } from "../runtime/operation";
import { internal } from "../operations";
import { sendSmtpEmail } from "./smtp";
import { serverEnv } from "../config/env";
export const sendApproval = internalAction({
  args: { id: v.id("earlyAccessRequests"), generation: v.number() },
  handler: async (ctx, args) => {
    const row = await ctx.runQuery(internal.earlyAccess.delivery, args);
    if (!row) return;
    try {
      const link = new URL(
        "/sign-up",
        serverEnv("SITE_URL") ?? "https://app.dirrio.com",
      );
      const result = await sendSmtpEmail({
        to: row.email,
        ...approvalEmail(row.locale, link.toString()),
        idempotencyKey: `waitlist:${args.id}:${args.generation}`,
      });
      await ctx.runMutation(internal.earlyAccess.recordDelivery, {
        ...args,
        sent: result.sent,
      });
      if (!result.sent) throw new Error("Approval email delivery unavailable");
    } catch (error) {
      await ctx.runMutation(internal.earlyAccess.recordDelivery, {
        ...args,
        sent: false,
      });
      throw error;
    }
  },
});
