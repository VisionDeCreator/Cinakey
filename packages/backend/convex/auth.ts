import Google from "@auth/core/providers/google";
import { Password } from "@convex-dev/auth/providers/Password";
import { convexAuth } from "@convex-dev/auth/server";
import { ensurePersonalWorkspaceForUser } from "./lib/workspaces";

export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [Password, Google],
  callbacks: {
    async afterUserCreatedOrUpdated(ctx, { userId, existingUserId }) {
      // Only provision on first create, not on every profile update.
      if (existingUserId !== null) {
        return;
      }
      await ensurePersonalWorkspaceForUser(ctx, userId);
    },
  },
});
