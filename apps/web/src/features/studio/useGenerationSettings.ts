import { useEffect, useMemo, useSyncExternalStore } from "react";
import { api, type Id } from "@cinakey/backend";
import { useMutation, useQuery } from "@/lib/api/hooks";
import { GenerationSettingsDraft } from "./generationSettingsDraft";

export function useGenerationSettings(projectId: string) {
  const server = useQuery(api.projects.generationSettings, {
    projectId: projectId as Id<"projects">,
  });
  const save = useMutation(api.projects.saveGenerationSettings);
  const draft = useMemo(
    () =>
      new GenerationSettingsDraft((patch) =>
        save({ projectId: projectId as Id<"projects">, ...patch }),
      ),
    [projectId, save],
  );
  const state = useSyncExternalStore(draft.subscribe, draft.getSnapshot);
  useEffect(() => {
    draft.observe(server);
  }, [draft, server, state.saving]);
  useEffect(() => () => draft.dispose(), [draft]);
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
    loaded: server !== undefined,
    saving: state.saving,
    pending: Object.keys(state.patch).length > 0 && !state.saved,
    error: state.error,
    saved: state.saved,
    update: draft.change,
    flush: draft.flush,
    retry: draft.retry,
  };
}
