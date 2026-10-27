import { useWorkspace } from "@/features/workspaces/workspace-context";
import { useAction, useMutation } from "@/lib/api/hooks";
import { api, type Id } from "@cinakey/backend";
import { useCallback, useState } from "react";

const STARTER_CLIPS = [
  { path: "/starter/clip-a.mp4", name: "Starter clip A", durationSec: 3 },
  { path: "/starter/clip-b.mp4", name: "Starter clip B", durationSec: 4 },
  { path: "/starter/clip-c.mp4", name: "Starter clip C", durationSec: 5 },
] as const;

/**
 * Create the guided starter project and upload sample clips as project media.
 */
export function useCreateStarterProject() {
  const { workspaceId } = useWorkspace();
  const createStarter = useAction(api.workspace.createTemplate);
  const createUploadUrl = useMutation(api.storage.createUploadUrl);
  const createAsset = useMutation(api.storage.createAssetFromUpload);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(async (): Promise<Id<"projects">> => {
    setBusy(true);
    setError(null);
    try {
      const shell = await createStarter(workspaceId ? { workspaceId } : {});

      for (let i = 0; i < STARTER_CLIPS.length; i++) {
        const clip = STARTER_CLIPS[i]!;
        const res = await fetch(clip.path);
        if (!res.ok) {
          throw new Error(`Failed to load sample clip ${clip.path}`);
        }
        const blob = await res.blob();
        const uploadUrl = await createUploadUrl({ projectId: shell.projectId });
        const uploadRes = await fetch(uploadUrl, {
          method: "POST",
          headers: { "Content-Type": blob.type || "video/mp4" },
          body: blob,
        });
        if (!uploadRes.ok) {
          throw new Error("Failed to upload sample clip");
        }
        const { storageId } = (await uploadRes.json()) as {
          storageId: Id<"_storage">;
        };
        await createAsset({
          projectId: shell.projectId,
          storageId,
          type: "video",
          name: clip.name,
          format: "video/mp4",
          durationSec: clip.durationSec,
          width: 640,
          height: 360,
          tags: ["starter", "sample"],
        });
      }

      return shell.projectId;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Starter failed";
      setError(message);
      throw err;
    } finally {
      setBusy(false);
    }
  }, [createAsset, createStarter, createUploadUrl, workspaceId]);

  return { run, busy, error };
}
