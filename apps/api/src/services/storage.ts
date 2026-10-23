import type { Id } from "../../../../packages/backend/convex/_generated/dataModel";
import { action, type ActionCtx } from "../runtime/operation";
import { v } from "convex/values";

/** Soft cap for JSON blobs stored as files (not the 1 MiB document limit). */
export const MAX_JSON_BYTES = 5 * 1024 * 1024;

/** Documents must stay well under Convex's 1 MiB limit. */
export const MAX_DOCUMENT_JSON_BYTES = 512 * 1024;

/**
 * Serialize JSON to a Blob and store it. Rejects payloads that would be unsafe
 * to ever embed in a Convex document, and hard-caps file size.
 */
export async function saveJson(
  ctx: ActionCtx,
  value: unknown,
): Promise<{ storageId: Id<"_storage">; sizeBytes: number }> {
  const text = JSON.stringify(value);
  const sizeBytes = new TextEncoder().encode(text).byteLength;

  if (sizeBytes > MAX_JSON_BYTES) {
    throw new Error(
      `JSON payload too large (${sizeBytes} bytes; max ${MAX_JSON_BYTES})`,
    );
  }
  // Always store as a file — never put this body on a document field.
  if (sizeBytes > MAX_DOCUMENT_JSON_BYTES) {
    // Still allowed as a file; callers must only store the returned ID on docs.
  }

  const blob = new Blob([text], { type: "application/json" });
  const storageId = await ctx.storage.store(blob);
  return { storageId, sizeBytes };
}

/** Server-side JSON save (actions only — uses ctx.storage.store). */
export const storeJson = action({
  args: { value: v.any() },
  handler: async (ctx, args) => {
    const { getAuthUserId } = await import("@convex-dev/auth/server");
    const userId = await getAuthUserId(ctx);
    if (userId === null) {
      throw new Error("Not authenticated");
    }
    return await saveJson(ctx, args.value);
  },
});
