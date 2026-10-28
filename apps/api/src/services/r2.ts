/* eslint-disable @typescript-eslint/no-explicit-any -- Dynamic storage references bridge query and mutation contracts. */
import { randomUUID } from "node:crypto";
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  DeleteObjectCommand,
  CopyObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

export function r2Config() {
  const names = [
    "R2_ACCOUNT_ID",
    "R2_ENDPOINT",
    "R2_BUCKET",
    "R2_ACCESS_KEY_ID",
    "R2_SECRET_ACCESS_KEY",
  ] as const;
  const values = Object.fromEntries(
    names.map((name) => [name, process.env[name]?.trim()]),
  );
  if (names.some((name) => !values[name]))
    throw new Error(
      "Configure all R2 environment variables in the server environment",
    );
  const endpoint = new URL(values.R2_ENDPOINT!);
  const account = values.R2_ACCOUNT_ID!;
  if (
    !/^[a-f0-9]{32}$/i.test(account) ||
    endpoint.protocol !== "https:" ||
    !new RegExp(
      `^${account}(?:\\.(?:eu|us|fedramp))?\\.r2\\.cloudflarestorage\\.com$`,
      "i",
    ).test(endpoint.hostname) ||
    endpoint.username ||
    endpoint.password ||
    endpoint.port ||
    endpoint.search ||
    endpoint.hash ||
    !["", "/"].includes(endpoint.pathname)
  )
    throw new Error("R2_ENDPOINT must be the account's HTTPS R2 S3 endpoint");
  return {
    bucket: values.R2_BUCKET!,
    endpoint: endpoint.origin,
    region: "auto",
    credentials: {
      accessKeyId: values.R2_ACCESS_KEY_ID!,
      secretAccessKey: values.R2_SECRET_ACCESS_KEY!,
    },
  };
}
function client() {
  const config = r2Config();
  return { client: new S3Client(config), bucket: config.bucket };
}
export function objectKey() {
  return `media/${randomUUID()}`;
}
export async function signUpload(
  key: string,
  contentType: string,
  size: number,
) {
  const { client: s3, bucket } = client();
  return getSignedUrl(
    s3,
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      ContentType: contentType,
      ContentLength: size,
    }),
    { expiresIn: 900 },
  );
}
export async function signDownload(
  key: string,
  bucket: string,
  download = false,
  expiresIn = 86400,
) {
  const { client: s3, bucket: configured } = client();
  if (bucket !== configured)
    throw new Error("Media belongs to a different R2 bucket");
  return getSignedUrl(
    s3,
    new GetObjectCommand({
      Bucket: bucket,
      Key: key,
      ...(download
        ? { ResponseContentDisposition: 'attachment; filename="video.mp4"' }
        : {}),
    }),
    {
      expiresIn,
      // Keep editor URLs stable across query refreshes within a six-hour window.
      ...(expiresIn === 86400
        ? {
            signingDate: new Date(
              Math.floor(Date.now() / 21600_000) * 21600_000,
            ),
          }
        : {}),
    },
  );
}
export async function inspectObject(key: string) {
  const { client: s3, bucket } = client();
  const head = await s3.send(
    new HeadObjectCommand({ Bucket: bucket, Key: key }),
  );
  return {
    size: head.ContentLength ?? 0,
    contentType:
      head.ContentType?.split(";")[0]?.trim().toLowerCase() ??
      "application/octet-stream",
    bucket,
  };
}
export async function putObject(key: string, blob: Blob) {
  const { client: s3, bucket } = client();
  await s3.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: new Uint8Array(await blob.arrayBuffer()),
      ContentType: blob.type || "application/octet-stream",
    }),
  );
  return bucket;
}
export async function removeObject(key: string, bucket: string) {
  const { client: s3, bucket: configured } = client();
  if (bucket !== configured)
    throw new Error("Media belongs to a different R2 bucket");
  await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
}
/** Queries only emit references after their existing access checks. Sign at the HTTP boundary. */
export async function resolveMediaUrls(
  value: unknown,
  lookup: (
    id: string,
  ) => Promise<{ key: string; bucket: string; deletedAt?: number } | null>,
): Promise<any> {
  if (typeof value === "string" && value.startsWith("r2://")) {
    const file = await lookup(value.slice(5));
    return file && !file.deletedAt ? signDownload(file.key, file.bucket) : null;
  }
  if (Array.isArray(value))
    return Promise.all(value.map((item) => resolveMediaUrls(item, lookup)));
  if (
    value &&
    typeof value === "object" &&
    Object.getPrototypeOf(value) === Object.prototype
  )
    return Object.fromEntries(
      await Promise.all(
        Object.entries(value).map(async ([key, item]) => [
          key,
          await resolveMediaUrls(item, lookup),
        ]),
      ),
    );
  return value;
}

export async function sealUpload(source: string, target: string) {
  const { client: s3, bucket } = client();
  await s3.send(
    new CopyObjectCommand({
      Bucket: bucket,
      Key: target,
      CopySource: `${bucket}/${source}`,
    }),
  );
}

export async function objectHeader(key: string) {
  const { client: s3, bucket } = client();
  const result = await s3.send(
    new GetObjectCommand({ Bucket: bucket, Key: key, Range: "bytes=0-511" }),
  );
  return result.Body ? result.Body.transformToByteArray() : new Uint8Array();
}
