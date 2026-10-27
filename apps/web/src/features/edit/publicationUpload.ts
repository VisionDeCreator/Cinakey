import type { ApiClient } from "@/lib/api/client";
export function uploadPublication(
  client: ApiClient,
  publicationId: string,
  blob: Blob,
  signal: AbortSignal,
  onProgress: (percent: number) => void,
) {
  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const abort = () => xhr.abort();
    const finish = (error?: Error) => {
      signal.removeEventListener("abort", abort);
      if (error) reject(error);
      else resolve();
    };
    if (signal.aborted) {
      reject(new DOMException("Upload canceled", "AbortError"));
      return;
    }
    xhr.open("POST", `${client.baseUrl}/exports/${publicationId}/upload`);
    xhr.timeout = 600_000;
    xhr.setRequestHeader("Authorization", `Bearer ${client.token}`);
    xhr.setRequestHeader("Content-Type", "video/mp4");
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable)
        onProgress(Math.round((event.loaded / event.total) * 100));
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) finish();
      else {
        let message =
          "Upload failed. Your downloaded MP4 is safe; retry the upload.";
        try {
          message = JSON.parse(xhr.responseText).message ?? message;
        } catch {
          /* generic response */
        }
        finish(new Error(message));
      }
    };
    xhr.onerror = () =>
      finish(
        new Error(
          "Upload connection lost. Retry to check whether publication completed.",
        ),
      );
    xhr.ontimeout = () =>
      finish(
        new Error(
          "Upload timed out. Retry to check whether publication completed.",
        ),
      );
    xhr.onabort = () =>
      finish(new DOMException("Upload canceled", "AbortError"));
    signal.addEventListener("abort", abort, { once: true });
    xhr.send(blob);
  });
}
