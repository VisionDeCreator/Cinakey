import { api } from "@cinakey/backend";
import {
  createEmptyScript,
  extractCharacterNames,
  type ScriptDocument,
  type ScriptFormat,
} from "@cinakey/shared";
import { useAction, useQuery } from "convex/react";
import { useCallback, useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  formatDuration,
  ScriptEditor,
  type ScriptSelection,
  useScriptDocument,
} from "@/features/script/ScriptEditor";
import { ScriptHistorySheet } from "@/features/script/ScriptHistorySheet";
import { useCopilotContext } from "@/features/copilot/CopilotContext";
import { cn } from "@/lib/utils";

export function ScriptRoomPage() {
  const { projectId } = useParams();
  const project = useQuery(
    api.projects.get,
    projectId ? { projectId: projectId as never } : "skip",
  );
  const tip = useQuery(
    api.scriptVersions.getTip,
    projectId ? { projectId: projectId as never } : "skip",
  );
  const entities = useQuery(
    api.entities.listForProject,
    projectId ? { projectId: projectId as never, kind: "character" } : "skip",
  );
  const getContent = useAction(api.scriptVersions.getContent);
  const commit = useAction(api.scriptVersions.commit);

  const [loaded, setLoaded] = useState<ScriptDocument | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [selection, setSelection] = useState<ScriptSelection>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const { document, setDocument, dirty, setDirty, runtime } =
    useScriptDocument(loaded);

  const { setContext } = useCopilotContext();

  const reload = useCallback(async () => {
    if (!projectId) return;
    setLoadError(null);
    try {
      const result = await getContent({ projectId: projectId as never });
      setLoaded(result.document ?? createEmptyScript("screenplay"));
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Failed to load script");
      setLoaded(createEmptyScript("screenplay"));
    }
  }, [getContent, projectId]);

  useEffect(() => {
    void reload();
  }, [reload, reloadKey, tip?._id]);

  useEffect(() => {
    if (!projectId) return;
    setContext({
      view: "script",
      projectId,
      selectionIds: selectionIdsFrom(selection),
    });
  }, [projectId, selection, setContext]);

  const setFormat = (format: ScriptFormat) => {
    setDocument({ ...document, format });
  };

  const handleSave = async () => {
    if (!projectId) return;
    setSaving(true);
    setLoadError(null);
    try {
      const result = await commit({
        projectId: projectId as never,
        document,
        label: dirty ? "Manual save" : "Save",
      });
      setLoaded(result.document as ScriptDocument);
      setDirty(false);
      setReloadKey((k) => k + 1);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  if (!projectId) return null;
  if (project === undefined || loaded === null) {
    return <p className="text-sm text-zinc-500">Loading script…</p>;
  }

  const target = project.targetLengthSec;
  const overTarget =
    target !== undefined && runtime.totalSec > target;
  const characters = extractCharacterNames(document);

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-800 pb-4">
        <div>
          <h2 className="text-lg font-semibold text-zinc-100">Script room</h2>
          <p className="text-xs text-zinc-500">
            Scenes, beats, and dialogue lines with stable IDs.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex rounded-sm border border-zinc-700 p-0.5">
            <FormatButton
              active={document.format === "screenplay"}
              onClick={() => setFormat("screenplay")}
            >
              Screenplay
            </FormatButton>
            <FormatButton
              active={document.format === "av"}
              onClick={() => setFormat("av")}
            >
              A/V
            </FormatButton>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setHistoryOpen(true)}
          >
            History
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={saving || !dirty}
            onClick={() => void handleSave()}
          >
            {saving ? "Saving…" : dirty ? "Save version" : "Saved"}
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3 text-sm">
        <span className="text-zinc-400">
          Runtime{" "}
          <span className="font-medium text-zinc-100">
            {formatDuration(runtime.totalSec)}
          </span>
        </span>
        {target !== undefined ? (
          <span
            className={cn(
              "text-zinc-500",
              overTarget && "text-amber-400",
            )}
          >
            Target {formatDuration(target)}
            {overTarget ? " (over)" : ""}
          </span>
        ) : null}
        {runtime.perScene.length > 0 ? (
          <span className="text-xs text-zinc-600">
            {runtime.perScene
              .map((s, i) => `S${i + 1} ${formatDuration(s.durationSec)}`)
              .join(" · ")}
          </span>
        ) : null}
      </div>

      {(characters.length > 0 || (entities && entities.length > 0)) && (
        <div className="flex flex-wrap gap-1.5">
          {characters.map((name) => (
            <Badge key={name} variant="secondary" className="text-xs">
              {name}
            </Badge>
          ))}
        </div>
      )}

      {loadError ? (
        <p className="text-sm text-red-400">{loadError}</p>
      ) : null}

      <ScriptEditor
        document={document}
        onChange={setDocument}
        selection={selection}
        onSelect={setSelection}
      />

      <ScriptHistorySheet
        projectId={projectId}
        open={historyOpen}
        onOpenChange={setHistoryOpen}
        onRestored={() => {
          setDirty(false);
          setReloadKey((k) => k + 1);
        }}
      />
    </div>
  );
}

function FormatButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-sm px-2.5 py-1 text-xs transition-colors",
        active
          ? "bg-zinc-100 text-zinc-900"
          : "text-zinc-400 hover:text-zinc-200",
      )}
    >
      {children}
    </button>
  );
}

function selectionIdsFrom(selection: ScriptSelection): string[] {
  if (!selection) return [];
  if (selection.type === "scene") return [selection.sceneId];
  if (selection.type === "beat") return [selection.sceneId, selection.beatId];
  return [selection.sceneId, selection.beatId, selection.lineId];
}
