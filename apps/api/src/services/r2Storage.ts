/* eslint-disable @typescript-eslint/no-explicit-any -- Dynamic storage references bridge query and mutation contracts. */
import { randomUUID } from "node:crypto";
import { v } from "convex/values";
import { makeFunctionReference } from "convex/server";
import { action, internalAction, type ActionCtx } from "../runtime/operation";
import {
  r2Config,
  objectKey,
  signUpload,
  inspectObject,
  removeObject,
  sealUpload,
  objectHeader,
} from "./r2";
import {
  ASSET_ALLOWED_MIME,
  ASSET_MAX_BYTES,
} from "../../../../packages/backend/convex/storage";
const ref = (name: string) => makeFunctionReference<any>(`storageIO:${name}`);
export function validateMediaUpload(contentType: string, size: number) {
  const type = contentType.split(";")[0]!.trim().toLowerCase();
  const limits = Object.entries(ASSET_ALLOWED_MIME)
    .filter(([kind, allowed]) => kind !== "json" && allowed.includes(type))
    .map(([kind]) => ASSET_MAX_BYTES[kind as keyof typeof ASSET_MAX_BYTES]);
  if (
    !Number.isSafeInteger(size) ||
    size <= 0 ||
    !limits.length ||
    size > Math.max(...limits)
  )
    throw new Error("Unsupported media type or file size");
  return type;
}
async function begin(
  ctx: ActionCtx,
  scope: { projectId?: string; seriesId?: string },
) {
  r2Config();
  const token = randomUUID();
  await ctx.runMutation(ref("beginR2Upload"), {
    ...scope,
    token,
    key: objectKey().replace(/^media\//, "staging/"),
  });
  return `/storage/uploads/${token}`;
}
export const createProjectUpload = action({
  args: { projectId: v.id("projects") },
  handler: (ctx, { projectId }) => begin(ctx, { projectId }),
});
export const createSeriesUpload = action({
  args: { seriesId: v.id("series") },
  handler: (ctx, { seriesId }) => begin(ctx, { seriesId }),
});
export async function prepareUpload(
  ctx: ActionCtx,
  token: string,
  body: { contentType: string; size: number },
) {
  const contentType = validateMediaUpload(body.contentType, body.size);
  const session = await ctx.runMutation(ref("prepareR2Upload"), {
    token,
    contentType,
    size: body.size,
  });
  return { uploadUrl: await signUpload(session.key, contentType, body.size) };
}
async function cleanupCompletedStaging(key: string, bucket: string) {
  try {
    await removeObject(key, bucket);
  } catch {
    // Completion is already committed. The retained session lets delayed cleanup retry.
  }
}
export async function completeUpload(ctx: ActionCtx, token: string) {
  const session = await ctx.runMutation(ref("claimR2Upload"), { token });
  if (session.fileId) {
    await cleanupCompletedStaging(session.key, r2Config().bucket);
    return { storageId: session.fileId };
  }
  const key = session.key.replace(/^staging\//, "media/");
  try {
    // Copy once to an immutable key. A still-valid PUT URL cannot alter a registered asset.
    await sealUpload(session.key, key);
    const metadata = await inspectObject(key);
    validateMediaUpload(metadata.contentType, metadata.size);
    validateMediaHeader(metadata.contentType, await objectHeader(key));
    const storageId = await ctx.runMutation(ref("completeR2Upload"), {
      token,
      key,
      ...metadata,
    });
    await cleanupCompletedStaging(session.key, metadata.bucket);
    return { storageId };
  } catch {
    await ctx.runMutation(ref("releaseR2Upload"), { token });
    throw new Error(
      "Upload verification failed. Retry completion or upload a new file.",
    );
  }
}
export const deleteObject = internalAction({
  args: { id: v.id("r2Files"), key: v.string(), bucket: v.string() },
  handler: async (ctx, args) => {
    await removeObject(args.key, args.bucket);
    await ctx.runMutation(ref("forgetR2File"), { id: args.id });
  },
});
export const removeAbandonedUpload = internalAction({
  args: { key: v.string(), finalKey: v.optional(v.string()) },
  handler: async (_ctx, args) => {
    const { bucket } = r2Config();
    await removeObject(args.key, bucket);
    if (args.finalKey) await removeObject(args.finalKey, bucket);
  },
});

/** Reject obvious type spoofing before the file can become a project asset. */
export function validateMediaHeader(contentType: string, bytes: Uint8Array) {
  const text = new TextDecoder().decode(bytes);
  const starts = (...values: number[]) =>
    values.every((value, index) => bytes[index] === value);
  const riff = (kind: string) =>
    text.startsWith("RIFF") && text.slice(8, 12) === kind;
  const mp4 = text.slice(4, 8) === "ftyp";
  const webm = starts(0x1a, 0x45, 0xdf, 0xa3);
  const valid: Record<string, boolean> = {
    "image/png": starts(137, 80, 78, 71, 13, 10, 26, 10),
    "image/jpeg": starts(255, 216, 255),
    "image/gif": /^(GIF87a|GIF89a)/.test(text),
    "image/webp": riff("WEBP"),
    "image/svg+xml": /<svg[\s>]/i.test(text),
    "video/mp4": mp4,
    "video/quicktime": mp4 || text.slice(4, 8) === "moov",
    "video/webm": webm,
    "audio/webm": webm,
    "audio/mp4": mp4,
    "audio/wav": riff("WAVE"),
    "audio/ogg": text.startsWith("OggS"),
    "audio/mpeg":
      text.startsWith("ID3") ||
      (bytes[0] === 255 && (bytes[1]! & 0xe0) === 0xe0),
  };
  if (!valid[contentType])
    throw new Error("Media contents do not match its content type");
}
