import { loadRootEnvironment } from "../apps/api/src/config/load-root-env";
import {
  r2Config,
  objectKey,
  signUpload,
  signDownload,
  inspectObject,
  removeObject,
  sealUpload,
  objectHeader,
} from "../apps/api/src/services/r2";
import { validateMediaHeader } from "../apps/api/src/services/r2Storage";
loadRootEnvironment();
const config = r2Config();
const key = objectKey().replace(/^media\//, "staging/");
const finalKey = key.replace(/^staging\//, "media/");
// A valid one-pixel PNG, used only for this check and always deleted.
const bytes = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=",
  "base64",
);
try {
  const put = await signUpload(key, "image/png", bytes.length);
  const origins = (
    process.env.WEB_ORIGINS ?? "http://localhost:5173,http://localhost:5174"
  )
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  for (const origin of origins) {
    const preflight = await fetch(put, {
      method: "OPTIONS",
      headers: {
        Origin: origin,
        "Access-Control-Request-Method": "PUT",
        "Access-Control-Request-Headers": "content-type",
      },
    });
    const allowed = preflight.headers.get("access-control-allow-origin");
    if (!preflight.ok || (allowed !== origin && allowed !== "*"))
      process.exitCode = 1;
    console.log(
      `Browser upload CORS (${origin}): ${preflight.ok && (allowed === origin || allowed === "*") ? "PASS" : "FAIL"}`,
    );
  }
  const uploaded = await fetch(put, {
    method: "PUT",
    headers: { "Content-Type": "image/png" },
    body: bytes,
  });
  if (!uploaded.ok)
    throw new Error(`Signed upload failed (${uploaded.status})`);
  console.log("Signed direct upload: PASS");
  await sealUpload(key, finalKey);
  console.log("Seal staging object to immutable media key: PASS");
  const metadata = await inspectObject(finalKey);
  if (metadata.size !== bytes.length || metadata.contentType !== "image/png")
    throw new Error("Metadata mismatch");
  validateMediaHeader(metadata.contentType, await objectHeader(finalKey));
  console.log("Server metadata and media signature verification: PASS");
  const get = await signDownload(finalKey, config.bucket);
  const downloaded = await fetch(get);
  if (
    !downloaded.ok ||
    !bytes.equals(Buffer.from(await downloaded.arrayBuffer()))
  )
    throw new Error("Download mismatch");
  console.log("Signed download and content integrity: PASS");
  const range = await fetch(get, { headers: { Range: "bytes=0-7" } });
  if (range.status !== 206 || (await range.arrayBuffer()).byteLength !== 8)
    throw new Error("Range delivery failed");
  console.log("Byte-range delivery for media seeking: PASS");
  for (const origin of origins) {
    const response = await fetch(get, {
      headers: { Origin: origin, Range: "bytes=0-7" },
    });
    const allowed = response.headers.get("access-control-allow-origin");
    await response.body?.cancel();
    if (!response.ok || (allowed !== origin && allowed !== "*"))
      process.exitCode = 1;
    console.log(
      `Browser media CORS (${origin}): ${response.ok && (allowed === origin || allowed === "*") ? "PASS" : "FAIL"}`,
    );
  }
} catch {
  console.error(
    "R2 integration verification failed; credentials and signed URLs have been withheld.",
  );
  process.exitCode = 1;
} finally {
  await removeObject(key, config.bucket);
  await removeObject(finalKey, config.bucket);
  console.log("Temporary staging and media objects deleted.");
}
