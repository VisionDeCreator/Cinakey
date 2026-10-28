/** Media bytes travel directly to R2; the API only authorizes and verifies them. */
export async function uploadMedia(
  sessionPath: string,
  body: Blob,
): Promise<Response> {
  if (!/^\/storage\/uploads\/[a-f0-9-]{36}$/.test(sessionPath))
    throw new Error("Invalid media upload session");
  const base = (
    import.meta.env.VITE_API_URL ?? "http://localhost:3001"
  ).replace(/\/$/, "");
  const url = `${base}${sessionPath}`;
  const prepared = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contentType: body.type || "application/octet-stream",
      size: body.size,
    }),
  });
  if (!prepared.ok) throw new Error("Could not authorize media upload");
  const { uploadUrl } = (await prepared.json()) as { uploadUrl: string };
  const uploaded = await fetch(uploadUrl, {
    method: "PUT",
    headers: { "Content-Type": body.type.split(";")[0]!.trim().toLowerCase() },
    body,
  });
  if (!uploaded.ok) throw new Error(`Media upload failed (${uploaded.status})`);
  // Completion is idempotent, including a lost response after registration.
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const completed = await fetch(`${url}/complete`, { method: "POST" });
      if (completed.ok) return completed;
      if (attempt === 2) return completed;
    } catch (error) {
      if (attempt === 2) throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)));
  }
  throw new Error("Could not verify media upload");
}
