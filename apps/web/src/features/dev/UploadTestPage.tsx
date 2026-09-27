import { api } from "@cinakey/backend";
import { useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";

/**
 * Dev/test page: upload a file to Convex storage, create an asset, display it.
 */
export function UploadTestPage() {
  const projects = useQuery(api.projects.listMine, {});
  const createProject = useMutation(api.projects.create);
  const createUploadUrl = useMutation(api.storage.createUploadUrl);
  const createAsset = useMutation(api.storage.createAssetFromUpload);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [assetId, setAssetId] = useState<string | null>(null);
  const [status, setStatus] = useState<string>("");
  const [busy, setBusy] = useState(false);

  const asset = useQuery(
    api.storage.getAsset,
    assetId ? { assetId: assetId as never } : "skip",
  );
  const url = useQuery(
    api.storage.getAssetUrl,
    assetId ? { assetId: assetId as never } : "skip",
  );

  async function ensureProject(): Promise<string> {
    if (projectId) return projectId;
    if (projects && projects.length > 0) {
      const id = projects[0]!.project._id;
      setProjectId(id);
      return id;
    }
    const id = await createProject({ title: "Upload Test Project" });
    setProjectId(id);
    return id;
  }

  async function onFileChange(file: File | null) {
    if (!file) return;
    setBusy(true);
    setStatus("Uploading…");
    try {
      const pid = await ensureProject();
      const uploadUrl = await createUploadUrl();
      const result = await fetch(uploadUrl, {
        method: "POST",
        headers: { "Content-Type": file.type || "application/octet-stream" },
        body: file,
      });
      if (!result.ok) {
        throw new Error(`Upload failed: ${result.status}`);
      }
      const { storageId } = (await result.json()) as { storageId: string };
      const type =
        file.type.startsWith("image/")
          ? ("image" as const)
          : file.type.startsWith("video/")
            ? ("video" as const)
            : file.type.startsWith("audio/")
              ? ("audio" as const)
              : ("other" as const);
      const id = await createAsset({
        projectId: pid as never,
        storageId: storageId as never,
        type,
        name: file.name,
        format: file.type || "application/octet-stream",
      });
      setAssetId(id);
      setStatus(`Created asset ${id}`);
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto flex max-w-lg flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold text-zinc-100">Upload test</h1>
        <p className="mt-1 text-sm text-zinc-400">
          Upload a file to verify storage → asset metadata → served URL.
        </p>
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="file">File</Label>
        <input
          id="file"
          type="file"
          disabled={busy}
          className="text-sm text-zinc-300 file:mr-3 file:rounded-md file:border-0 file:bg-zinc-800 file:px-3 file:py-1.5 file:text-sm file:text-zinc-100"
          onChange={(e) => void onFileChange(e.target.files?.[0] ?? null)}
        />
      </div>

      {status ? <p className="text-sm text-zinc-400">{status}</p> : null}

      {asset ? (
        <dl className="grid grid-cols-[8rem_1fr] gap-x-3 gap-y-1 text-sm">
          <dt className="text-zinc-500">Type</dt>
          <dd className="text-zinc-200">{asset.type}</dd>
          <dt className="text-zinc-500">Format</dt>
          <dd className="text-zinc-200">{asset.format}</dd>
          <dt className="text-zinc-500">Size</dt>
          <dd className="text-zinc-200">{asset.sizeBytes} bytes</dd>
        </dl>
      ) : null}

      {url && asset?.type === "image" ? (
        <img
          src={url}
          alt="Uploaded asset"
          className="max-h-80 w-full rounded-md object-contain bg-zinc-900"
        />
      ) : null}

      {url && asset?.type !== "image" ? (
        <a
          href={url}
          target="_blank"
          rel="noreferrer"
          className="text-sm text-sky-400 underline"
        >
          Open file
        </a>
      ) : null}

      <Button
        type="button"
        variant="secondary"
        disabled={busy}
        onClick={() => {
          setAssetId(null);
          setStatus("");
        }}
      >
        Reset
      </Button>
    </div>
  );
}
