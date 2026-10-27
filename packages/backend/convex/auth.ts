import Google from "@auth/core/providers/google";
import { ConvexCredentials } from "@convex-dev/auth/providers/ConvexCredentials";
import { convexAuth } from "@convex-dev/auth/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import {
  authDigest,
  normalizeAuthEmail,
  verifiedEmailUser,
} from "./lib/authEmail";

export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [
    ConvexCredentials({
      id: "email-otp",
      authorize: async (params, ctx): Promise<{ userId: Id<"users"> }> => {
        const email = normalizeAuthEmail(params.email);
        if (
          typeof params.challenge !== "string" ||
          !/^[a-f0-9]{64}$/.test(params.challenge) ||
          typeof params.code !== "string" ||
          !/^\d{6}$/.test(params.code)
        )
          throw new Error("Code is incorrect or expired. Request a new code.");
        const result = await ctx.runMutation(internal.authOtp.consume, {
          email,
          challengeHash: await authDigest(params.challenge),
          codeHash: await authDigest(
            `${params.challenge}:${email}:${params.code}`,
          ),
        });
        if (!result.userId)
          throw new Error("Code is incorrect or expired. Request a new code.");
        return { userId: result.userId };
      },
    }),
    Google({
      profile(profile) {
        if (profile.email_verified !== true)
          throw new Error("Google email must be verified");
        return {
          id: profile.sub,
          email: normalizeAuthEmail(profile.email),
          name: profile.name,
          image: profile.picture,
          emailVerified: true,
        };
      },
    }),
  ],
  callbacks: {
    async createOrUpdateUser(ctx, args) {
      if (args.provider.id !== "google" || args.profile.emailVerified !== true)
        throw new Error("Verified Google sign-in is required");
      return verifiedEmailUser(
        ctx as MutationCtx,
        normalizeAuthEmail(args.profile.email),
        args.existingUserId,
        {
          ...(typeof args.profile.name === "string"
            ? { name: args.profile.name }
            : {}),
          ...(typeof args.profile.image === "string"
            ? { image: args.profile.image }
            : {}),
        },
      );
    },
  },
});
