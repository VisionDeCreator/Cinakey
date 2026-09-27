/**
 * Storage module — the ONLY place that may call Convex file storage APIs.
 *
 * Nothing else in the codebase (queries, mutations, actions, or the frontend)
 * may call `ctx.storage.*` directly. Route all file reads/writes through this
 * module so storage can later move to Cloudflare R2 by changing this file only.
 */

import type { Id } from "../_generated/dataModel";
import type { ActionCtx, MutationCtx, QueryCtx } from "../_generated/server";

type StorageCtx = MutationCtx | ActionCtx;
type ReadCtx = QueryCtx | MutationCtx | ActionCtx;

export async function generateUploadUrl(ctx: StorageCtx): Promise<string> {
  return await ctx.storage.generateUploadUrl();
}

export async function saveFile(
  ctx: ActionCtx,
  blob: Blob,
): Promise<Id<"_storage">> {
  return await ctx.storage.store(blob);
}

export async function getFileUrl(
  ctx: ReadCtx,
  storageId: Id<"_storage">,
): Promise<string | null> {
  return await ctx.storage.getUrl(storageId);
}

export async function deleteFile(
  ctx: StorageCtx,
  storageId: Id<"_storage">,
): Promise<void> {
  await ctx.storage.delete(storageId);
}
