import { api } from "@cinakey/backend";
import {
  ASSET_ALLOWED_MIME,
  ASSET_MAX_BYTES,
  type AssetType,
} from "@cinakey/shared";
import { useMutation } from "convex/react";
import { useCallback, useState } from "react";

export type UploadItem = {
  id: string;
  name: string;
  progress: number;
  status: "uploading" | "done" | "error";
  error?: string;
};

function inferType(file: File): AssetType | null {
  const mime = file.type.toLowerCase();
  if (mime.startsWith("image/")) {
    if (ASSET_ALLOWED_MIME.logo.includes(mime) && file.name.toLowerCase().includes("logo")) {
      return "logo";
    }
    return "image";
  }
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "audio";
  return null;
}

function validateClient(file: File, type: AssetType): string | null {
  const max = ASSET_MAX_BYTES[type];
  if (file.size > max) {
    return `File too large (max ${Math.round(max / (1024 * 1024))}MB for ${type})`;
  }
  const allowed = ASSET_ALLOWED_MIME[type];
  const mime = file.type.split(";")[0]!.trim().toLowerCase();
  if (mime && !allowed.includes(mime)) {
    return `Unsupported type "${file.type}" for ${type}`;
  }
  return null;
}

export function useAssetUpload(projectId: string | undefined) {
  const createUploadUrl = useMutation(api.storage.createUploadUrl);
  const createAsset = useMutation(api.storage.createAssetFromUpload);
  const [uploads, setUploads] = useState<UploadItem[]>([]);

  const uploadFiles = useCallback(
    async (files: FileList | File[]) => {
      if (!projectId) {
        throw new Error("Select a project before uploading");
      }
      const list = Array.from(files);
      for (const file of list) {
        const id = `${file.name}-${Date.now()}-${Math.random()}`;
        const type = inferType(file);
        if (type === null) {
          setUploads((prev) => [
            ...prev,
            {
              id,
              name: file.name,
              progress: 0,
              status: "error",
              error: "Unsupported file type",
            },
          ]);
          continue;
        }
        const clientError = validateClient(file, type);
        if (clientError) {
          setUploads((prev) => [
            ...prev,
            {
              id,
              name: file.name,
              progress: 0,
              status: "error",
              error: clientError,
            },
          ]);
          continue;
        }

        setUploads((prev) => [
          ...prev,
          { id, name: file.name, progress: 10, status: "uploading" },
        ]);

        try {
          const uploadUrl = await createUploadUrl();
          setUploads((prev) =>
            prev.map((u) => (u.id === id ? { ...u, progress: 40 } : u)),
          );

          const result = await fetch(uploadUrl, {
            method: "POST",
            headers: {
              "Content-Type": file.type || "application/octet-stream",
            },
            body: file,
          });
          if (!result.ok) {
            throw new Error(`Upload failed: ${result.status}`);
          }
          const { storageId } = (await result.json()) as { storageId: string };
          setUploads((prev) =>
            prev.map((u) => (u.id === id ? { ...u, progress: 80 } : u)),
          );

          await createAsset({
            projectId: projectId as never,
            storageId: storageId as never,
            type,
            name: file.name,
            format: file.type || "application/octet-stream",
          });

          setUploads((prev) =>
            prev.map((u) =>
              u.id === id ? { ...u, progress: 100, status: "done" } : u,
            ),
          );
        } catch (err) {
          setUploads((prev) =>
            prev.map((u) =>
              u.id === id
                ? {
                    ...u,
                    status: "error",
                    error:
                      err instanceof Error ? err.message : "Upload failed",
                  }
                : u,
            ),
          );
        }
      }
    },
    [projectId, createUploadUrl, createAsset],
  );

  const clearFinished = useCallback(() => {
    setUploads((prev) => prev.filter((u) => u.status === "uploading"));
  }, []);

  return { uploads, uploadFiles, clearFinished };
}
