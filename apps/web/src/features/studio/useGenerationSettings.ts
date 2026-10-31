import { useEffect, useMemo, useSyncExternalStore } from "react";
import { api, type Id } from "@dirrio/backend";
import { useMutation, useQuery } from "@/lib/api/hooks";
import { GenerationSettingsDraftStore } from "./generationSettingsDraft";

export function useGenerationSettings(projectId: string, segmentId?: string) {
  const server = useQuery(
    api.projects.generationSettings,
    segmentId
      ? {
          projectId: projectId as Id<"projects">,
          segmentId: segmentId as Id<"scriptSegments">,
        }
      : "skip",
  );
  const save = useMutation(api.projects.saveGenerationSettings);
  const drafts = useMemo(
    () =>
      new GenerationSettingsDraftStore((id, patch) =>
        id
          ? save({
              projectId: projectId as Id<"projects">,
              segmentId: id as Id<"scriptSegments">,
              ...patch,
            })
          : Promise.reject(new Error("Select a script segment first")),
      ),
    [projectId, save],
  );
  const draft = drafts.forSegment(segmentId ?? "");
  const state = useSyncExternalStore(draft.subscribe, draft.getSnapshot);
  useEffect(() => {
    draft.observe(server);
  }, [draft, server, state.saving]);
  useEffect(() => () => drafts.dispose(), [drafts]);
  const settings = {
    resolution: "720p" as "720p" | "1080p",
    durationSec: 5,
    aspectRatio: "16:9" as "16:9" | "9:16" | "1:1",
    useStaging: false,
    ...server,
    ...state.patch,
  };
  return {
    settings,
    loaded: Boolean(segmentId) && server !== undefined,
    saving: state.saving,
    pending: Object.keys(state.patch).length > 0 && !state.saved,
    error: state.error,
    saved: state.saved,
    update: draft.change,
    flush: draft.flush,
    retry: draft.retry,
  };
}
