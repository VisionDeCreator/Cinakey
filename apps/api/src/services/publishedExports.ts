import { v, ConvexError } from "convex/values";
import { createHash } from "node:crypto";
import {
  TIMELINE_EXPORT_MAX_DURATION_SEC,
  TIMELINE_EXPORT_MAX_LONG_EDGE,
} from "@cinakey/shared";
import type { Id } from "../../../../packages/backend/convex/_generated/dataModel";
import { MAX_EXPORT_BYTES } from "../../../../packages/backend/convex/publishedExports";
import { action, type ActionCtx } from "../runtime/operation";
import { api, internal } from "../operations";
import { readExportMetadata } from "./exportMetadata";

export const begin = action({
  args: {
    projectId: v.id("projects"),
    versionId: v.id("timelineVersions"),
    requestId: v.string(),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{ publicationId: Id<"publishedExports">; maxBytes: number }> => {
    const result = await ctx.runAction(api.timelineVersions.getContent, {
      projectId: args.projectId,
      versionId: args.versionId,
    });
    if (!result.document || !result.version)
      throw new Error("Save the timeline before publishing");
    const doc = result.document;
    if (
      doc.durationSec <= 0 ||
      doc.durationSec > TIMELINE_EXPORT_MAX_DURATION_SEC
    )
      throw new Error("Export duration exceeds supported limits");
    const [w = 0, h = 0] = doc.project.aspectRatio.split(":").map(Number);
    if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0)
      throw new Error("Invalid aspect ratio");
    const width =
      w >= h
        ? TIMELINE_EXPORT_MAX_LONG_EDGE
        : Math.round((TIMELINE_EXPORT_MAX_LONG_EDGE * w) / h);
    const height =
      h >= w
        ? TIMELINE_EXPORT_MAX_LONG_EDGE
        : Math.round((TIMELINE_EXPORT_MAX_LONG_EDGE * h) / w);
    const project = await ctx.runQuery(api.projects.get, {
      projectId: args.projectId,
    });
    const publicationId = await ctx.runMutation(
      internal.publishedExports.beginValidated,
      {
        ...args,
        title: project?.title ?? "Video",
        durationSec: doc.durationSec,
        width: Math.max(2, width - (width % 2)),
        height: Math.max(2, height - (height % 2)),
      },
    );
    return { publicationId, maxBytes: MAX_EXPORT_BYTES };
  },
});

export async function readBoundedUpload(
  request: Request,
  maxBytes = MAX_EXPORT_BYTES,
) {
  const length = request.headers.get("content-length");
  if (length && (!/^\d+$/.test(length) || Number(length) > maxBytes))
    throw new Error("Export upload exceeds the size limit");
  if (
    request.headers.get("content-type")?.split(";")[0]?.trim() !== "video/mp4"
  )
    throw new Error("Upload must be video/mp4");
  const reader = request.body?.getReader();
  if (!reader) throw new Error("Empty export upload");
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > maxBytes)
        throw new Error("Export upload exceeds the size limit");
      chunks.push(new Uint8Array(value));
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  if (!size) throw new Error("Empty export upload");
  return new Blob(chunks, { type: "video/mp4" });
}

async function performUpload(
  ctx: ActionCtx,
  publicationId: Id<"publishedExports">,
  request: Request,
) {
  const attempt = crypto.randomUUID();
  const publication = await ctx.runMutation(
    internal.publishedExports.claimUpload,
    { publicationId, attempt },
  );
  if (publication.state === "ready") return { publicationId };
  let storageId: Id<"_storage"> | undefined;
  let committing = false;
  try {
    const blob = await readBoundedUpload(request);
    // Require the MP4 signature as well as parsed video tracks, not the client MIME alone.
    const header = new Uint8Array(await blob.slice(0, 12).arrayBuffer());
    if (String.fromCharCode(...header.slice(4, 8)) !== "ftyp")
      throw new Error("Invalid MP4 container");
    const metadata = await readExportMetadata(blob);
    if (
      metadata.durationSec > TIMELINE_EXPORT_MAX_DURATION_SEC + 0.1 ||
      Math.max(metadata.width, metadata.height) >
        TIMELINE_EXPORT_MAX_LONG_EDGE ||
      Math.abs(metadata.durationSec - publication.expectedDurationSec) > 0.75 ||
      metadata.width !== publication.expectedWidth ||
      metadata.height !== publication.expectedHeight
    )
      throw new Error("Export does not match its saved timeline");
    const sha256 = createHash("sha256")
      .update(new Uint8Array(await blob.arrayBuffer()))
      .digest("hex");
    storageId = await ctx.storage.store(blob);
    committing = true;
    await ctx.runMutation(internal.publishedExports.stageUpload, {
      publicationId,
      attempt,
      storageId,
    });
    await ctx.runMutation(internal.publishedExports.finalize, {
      publicationId,
      attempt,
      storageId,
      sizeBytes: blob.size,
      sha256,
      ...metadata,
    });
    return { publicationId };
  } catch (error) {
    // Unknown commit outcomes retain the blob and intent for safe status/retry recovery.
    if (!committing || error instanceof ConvexError) {
      await ctx.runMutation(internal.publishedExports.failUpload, {
        publicationId,
        attempt,
      });
      if (storageId) await ctx.storage.delete(storageId);
    }
    throw error;
  }
}

let activeUploads = 0;
export async function uploadPublication(
  ctx: ActionCtx,
  publicationId: Id<"publishedExports">,
  request: Request,
) {
  if (activeUploads >= 2)
    throw new Error("Export uploads are busy. Please retry shortly.");
  activeUploads++;
  try {
    return await performUpload(ctx, publicationId, request);
  } finally {
    activeUploads--;
  }
}
