/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import type { Id } from "../convex/_generated/dataModel";
import schema from "../convex/schema";

export const modules = import.meta.glob("../convex/**/*.*s");

export function makeTest() {
  return convexTest(schema, modules);
}

/** Identity subject format expected by Convex Auth's getAuthUserId. */
export function authIdentity(userId: Id<"users">) {
  return { subject: `${userId}|test-session` };
}

export async function createTestUser(
  t: ReturnType<typeof makeTest>,
  email: string,
  opts?: { isStaff?: boolean },
) {
  return await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", {
      email,
      emailVerificationTime: Date.now(),
      isStaff: opts?.isStaff,
    });
    return userId;
  });
}
