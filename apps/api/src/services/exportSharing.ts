import {
  randomBytes,
  createHash,
  scrypt as scryptCallback,
  timingSafeEqual,
} from "node:crypto";
import { promisify } from "node:util";
import { v } from "convex/values";
import { action, type ActionCtx } from "../runtime/operation";
import { internal } from "../operations";
import type { Id } from "../../../../packages/backend/convex/_generated/dataModel";
const scrypt = promisify(scryptCallback);
export const hashSecret = (value: string) =>
  createHash("sha256").update(value).digest("hex");
async function passwordHash(password: string) {
  const salt = randomBytes(16).toString("hex");
  const key = (await scrypt(password, salt, 64)) as Buffer;
  return `${salt}:${key.toString("hex")}`;
}
async function passwordMatches(password: string, hash: string) {
  if (password.length > 128) return false;
  const [salt, expected] = hash.split(":");
  if (!salt || !expected || !/^[a-f0-9]{128}$/.test(expected)) return false;
  const actual = (await scrypt(password, salt, 64)) as Buffer;
  return timingSafeEqual(actual, Buffer.from(expected, "hex"));
}
export const create = action({
  args: {
    publicationId: v.id("publishedExports"),
    password: v.optional(v.string()),
    allowDownload: v.boolean(),
    expiresAt: v.optional(v.number()),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{ linkId: Id<"exportShareLinks">; url: string }> => {
    if (
      args.password !== undefined &&
      (args.password.length < 8 || args.password.length > 128)
    )
      throw new Error("Use a share password between 8 and 128 characters");
    const secret = randomBytes(32).toString("hex");
    const linkId = await ctx.runMutation(internal.exportSharing.createHashed, {
      publicationId: args.publicationId,
      secretHash: hashSecret(secret),
      allowDownload: args.allowDownload,
      expiresAt: args.expiresAt,
      passwordHash: args.password
        ? await passwordHash(args.password)
        : undefined,
    });
    const url = new URL(
      `/share/${linkId}`,
      process.env.SITE_URL ?? "http://localhost:5173",
    );
    url.hash = secret;
    return { linkId, url: url.toString() };
  },
});
export async function exchangeShare(
  ctx: ActionCtx,
  linkId: Id<"exportShareLinks">,
  secret: string,
  password: string,
  client: string,
) {
  if (!/^[a-f0-9]{64}$/.test(secret) || password.length > 128)
    throw new Error("Share unavailable");
  const secretHash = hashSecret(secret);
  const link = await ctx.runMutation(internal.exportSharing.checkExchange, {
    linkId,
    secretHash,
    clientHash: hashSecret(client),
  });
  if (
    !link ||
    (link.passwordHash && !(await passwordMatches(password, link.passwordHash)))
  )
    throw new Error("Share unavailable");
  const token = randomBytes(32).toString("hex");
  const result = await ctx.runMutation(internal.exportSharing.openSession, {
    linkId,
    secretHash,
    tokenHash: hashSecret(token),
  });
  return { token, expiresAt: result.expiresAt };
}
export function viewerToken(request: Request) {
  const token = request.headers
    .get("cookie")
    ?.split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith("cinakey_share="))
    ?.slice("cinakey_share=".length);
  if (!token || !/^[a-f0-9]{64}$/.test(token))
    throw new Error("Share unavailable");
  return hashSecret(token);
}
export function byteRange(header: string | null, size: number) {
  if (!header) return { start: 0, end: size - 1, partial: false };
  const match = /^bytes=(\d*)-(\d*)$/.exec(header);
  if (!match || (!match[1] && !match[2])) throw new Error("Invalid byte range");
  const start = match[1]
    ? Number(match[1])
    : Math.max(0, size - Number(match[2]));
  const end = match[1]
    ? match[2]
      ? Math.min(Number(match[2]), size - 1)
      : size - 1
    : size - 1;
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    start < 0 ||
    start >= size ||
    end < start
  )
    throw new Error("Invalid byte range");
  return { start, end, partial: true };
}
export async function serveSharedMedia(
  ctx: ActionCtx,
  request: Request,
  linkId: Id<"exportShareLinks">,
) {
  const tokenHash = viewerToken(request);
  const download = new URL(request.url).searchParams.get("download") === "1";
  const publication = await ctx.runQuery(
    internal.exportSharing.authorizeViewer,
    { linkId, tokenHash, download },
  );
  let range;
  try {
    range = byteRange(request.headers.get("range"), publication.sizeBytes);
  } catch {
    return new Response(null, {
      status: 416,
      headers: {
        "Content-Range": `bytes */${publication.sizeBytes}`,
        "Cache-Control": "no-store",
      },
    });
  }
  const length = range.end - range.start + 1;
  const headers = new Headers({
    "Content-Type": "video/mp4",
    "Content-Length": String(length),
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, no-store",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "Content-Disposition": `${download ? "attachment" : "inline"}; filename="video.mp4"`,
  });
  if (range.partial)
    headers.set(
      "Content-Range",
      `bytes ${range.start}-${range.end}/${publication.sizeBytes}`,
    );
  if (request.method === "HEAD")
    return new Response(null, { status: range.partial ? 206 : 200, headers });
  const url = await ctx.storage.getUrl(publication.storageId);
  if (!url) throw new Error("Share unavailable");
  const source = await fetch(url, {
    headers: { Range: `bytes=${range.start}-${range.end}` },
    signal: request.signal,
  });
  if (
    source.status !== 206 ||
    source.headers.get("content-range") !==
      `bytes ${range.start}-${range.end}/${publication.sizeBytes}`
  ) {
    await source.body?.cancel();
    throw new Error("Media range delivery unavailable");
  }
  try {
    await ctx.runMutation(internal.exportSharing.recordDelivery, {
      linkId,
      tokenHash,
      download,
      bytes: length,
    });
  } catch (error) {
    await source.body?.cancel();
    throw error;
  }
  return new Response(source.body, {
    status: range.partial ? 206 : 200,
    headers,
  });
}
