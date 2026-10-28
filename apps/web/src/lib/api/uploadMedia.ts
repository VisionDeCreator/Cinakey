import { uploadProgress } from "./uploadProgress";
/** Media bytes travel directly to R2; the API only authorizes and verifies them. */
export async function uploadMedia(
  sessionPath: string,
  body: Blob,
  onProgress?: (percent: number) => void,
): Promise<Response> {
  if (!/^\/storage\/uploads\/[a-f0-9-]{36}$/.test(sessionPath))
    throw new Error("Invalid media upload session");
  const base = (
    import.meta.env.VITE_API_URL ?? "http://localhost:3001"
  ).replace(/\/$/, "");
  const url = `${base}${sessionPath}`;
  const id = crypto.randomUUID();
  const name = body instanceof File ? body.name : "Media upload";
  const progress = (percent: number) => {
    onProgress?.(percent);
    uploadProgress.update({ id, name, progress: percent, status: "uploading" });
  };
  progress(0);
  try {
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
    await new Promise<void>((resolve, reject) => {
      const request = new XMLHttpRequest();
      request.open("PUT", uploadUrl);
      request.setRequestHeader(
        "Content-Type",
        body.type.split(";")[0]!.trim().toLowerCase() ||
          "application/octet-stream",
      );
      request.upload.onprogress = (event) => {
        if (event.lengthComputable)
          progress(Math.min(99, Math.round((event.loaded / event.total) * 99)));
      };
      request.onload = () =>
        request.status >= 200 && request.status < 300
          ? resolve()
          : reject(new Error(`Media upload failed (${request.status})`));
      request.onerror = () =>
        reject(
          new Error(
            "Media upload failed. Check your connection and try again.",
          ),
        );
      request.onabort = () => reject(new Error("Media upload cancelled"));
      request.send(body);
    });
    // Completion is idempotent, including a lost response after registration.
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const completed = await fetch(`${url}/complete`, { method: "POST" });
        if (completed.ok) {
          onProgress?.(100);
          uploadProgress.update({ id, name, progress: 100, status: "done" });
          return completed;
        }
        if (attempt === 2) throw new Error("Could not verify media upload");
      } catch (error) {
        if (attempt === 2) throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)));
    }
    throw new Error("Could not verify media upload");
  } catch (error) {
    uploadProgress.update({
      id,
      name,
      progress: 0,
      status: "error",
      error: error instanceof Error ? error.message : "Upload failed",
    });
    throw error;
  }
}
