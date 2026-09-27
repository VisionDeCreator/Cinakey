import {
  createEmptyScript,
  estimateScriptRuntime,
  newScriptElementId,
  type ScriptBeat,
  type ScriptDialogueLine,
  type ScriptDocument,
  type ScriptFormat,
  type ScriptScene,
} from "@cinakey/shared";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

export type ScriptSelection =
  | { type: "scene"; sceneId: string }
  | { type: "beat"; sceneId: string; beatId: string }
  | { type: "line"; sceneId: string; beatId: string; lineId: string }
  | null;

type ScriptEditorProps = {
  document: ScriptDocument;
  onChange: (doc: ScriptDocument) => void;
  selection: ScriptSelection;
  onSelect: (selection: ScriptSelection) => void;
  className?: string;
};

export function ScriptEditor({
  document,
  onChange,
  selection,
  onSelect,
  className,
}: ScriptEditorProps) {
  const isAv = document.format === "av";

  const updateScene = (sceneId: string, patch: Partial<ScriptScene>) => {
    onChange({
      ...document,
      scenes: document.scenes.map((s) =>
        s.id === sceneId ? { ...s, ...patch } : s,
      ),
    });
  };

  const updateBeat = (
    sceneId: string,
    beatId: string,
    patch: Partial<ScriptBeat>,
  ) => {
    onChange({
      ...document,
      scenes: document.scenes.map((s) => {
        if (s.id !== sceneId) return s;
        return {
          ...s,
          beats: s.beats.map((b) => (b.id === beatId ? { ...b, ...patch } : b)),
        };
      }),
    });
  };

  const updateLine = (
    sceneId: string,
    beatId: string,
    lineId: string,
    patch: Partial<ScriptDialogueLine>,
  ) => {
    onChange({
      ...document,
      scenes: document.scenes.map((s) => {
        if (s.id !== sceneId) return s;
        return {
          ...s,
          beats: s.beats.map((b) => {
            if (b.id !== beatId) return b;
            return {
              ...b,
              lines: b.lines.map((l) =>
                l.id === lineId ? { ...l, ...patch } : l,
              ),
            };
          }),
        };
      }),
    });
  };

  const addScene = () => {
    const scene: ScriptScene = {
      id: newScriptElementId(),
      heading: "INT. LOCATION - DAY",
      beats: [
        {
          id: newScriptElementId(),
          action: "",
          lines: [],
        },
      ],
    };
    onChange({ ...document, scenes: [...document.scenes, scene] });
    onSelect({ type: "scene", sceneId: scene.id });
  };

  const addBeat = (sceneId: string) => {
    const beat: ScriptBeat = {
      id: newScriptElementId(),
      action: "",
      lines: [],
    };
    onChange({
      ...document,
      scenes: document.scenes.map((s) =>
        s.id === sceneId ? { ...s, beats: [...s.beats, beat] } : s,
      ),
    });
    onSelect({ type: "beat", sceneId, beatId: beat.id });
  };

  const addLine = (sceneId: string, beatId: string) => {
    const line: ScriptDialogueLine = {
      id: newScriptElementId(),
      characterName: "CHARACTER",
      dialogue: "",
    };
    onChange({
      ...document,
      scenes: document.scenes.map((s) => {
        if (s.id !== sceneId) return s;
        return {
          ...s,
          beats: s.beats.map((b) =>
            b.id === beatId ? { ...b, lines: [...b.lines, line] } : b,
          ),
        };
      }),
    });
    onSelect({ type: "line", sceneId, beatId, lineId: line.id });
  };

  return (
    <div className={cn("space-y-8", className)}>
      {document.scenes.length === 0 ? (
        <div className="border border-dashed border-zinc-700 px-6 py-10 text-center">
          <p className="text-sm text-zinc-400">No scenes yet.</p>
          <Button type="button" size="sm" className="mt-4" onClick={addScene}>
            Add scene
          </Button>
        </div>
      ) : null}

      {document.scenes.map((scene) => {
        const sceneSelected =
          selection?.type === "scene" && selection.sceneId === scene.id;
        return (
          <section
            key={scene.id}
            className={cn(
              "space-y-4 border-l-2 pl-4",
              sceneSelected ? "border-zinc-100" : "border-zinc-800",
            )}
          >
            <div
              className="cursor-pointer space-y-2"
              onClick={() => onSelect({ type: "scene", sceneId: scene.id })}
            >
              <Input
                value={scene.heading}
                onChange={(e) =>
                  updateScene(scene.id, { heading: e.target.value })
                }
                className={cn(
                  "border-0 bg-transparent px-0 text-sm font-semibold uppercase tracking-wide text-zinc-100 shadow-none focus-visible:ring-0",
                  isAv && "normal-case tracking-normal",
                )}
                aria-label="Scene heading"
              />
              <Textarea
                value={scene.synopsis ?? ""}
                onChange={(e) =>
                  updateScene(scene.id, {
                    synopsis: e.target.value || undefined,
                  })
                }
                placeholder="Scene synopsis (optional)"
                className="min-h-12 resize-none border-0 bg-transparent px-0 text-xs text-zinc-500 shadow-none focus-visible:ring-0"
              />
            </div>

            {scene.beats.map((beat) => (
              <div key={beat.id} className="space-y-3">
                {isAv ? (
                  <AvBeat
                    beat={beat}
                    sceneId={scene.id}
                    selection={selection}
                    onSelect={onSelect}
                    onUpdateBeat={(patch) =>
                      updateBeat(scene.id, beat.id, patch)
                    }
                    onUpdateLine={(lineId, patch) =>
                      updateLine(scene.id, beat.id, lineId, patch)
                    }
                    onAddLine={() => addLine(scene.id, beat.id)}
                  />
                ) : (
                  <ScreenplayBeat
                    beat={beat}
                    sceneId={scene.id}
                    selection={selection}
                    onSelect={onSelect}
                    onUpdateBeat={(patch) =>
                      updateBeat(scene.id, beat.id, patch)
                    }
                    onUpdateLine={(lineId, patch) =>
                      updateLine(scene.id, beat.id, lineId, patch)
                    }
                    onAddLine={() => addLine(scene.id, beat.id)}
                  />
                )}
              </div>
            ))}

            <div className="flex gap-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => addBeat(scene.id)}
              >
                Add beat
              </Button>
            </div>
          </section>
        );
      })}

      {document.scenes.length > 0 ? (
        <Button type="button" variant="outline" size="sm" onClick={addScene}>
          Add scene
        </Button>
      ) : null}
    </div>
  );
}

type BeatProps = {
  beat: ScriptBeat;
  sceneId: string;
  selection: ScriptSelection;
  onSelect: (s: ScriptSelection) => void;
  onUpdateBeat: (patch: Partial<ScriptBeat>) => void;
  onUpdateLine: (lineId: string, patch: Partial<ScriptDialogueLine>) => void;
  onAddLine: () => void;
};

function ScreenplayBeat({
  beat,
  sceneId,
  selection,
  onSelect,
  onUpdateBeat,
  onUpdateLine,
  onAddLine,
}: BeatProps) {
  const beatSelected =
    selection?.type === "beat" &&
    selection.sceneId === sceneId &&
    selection.beatId === beat.id;

  return (
    <div
      className={cn(
        "space-y-3 rounded-sm px-2 py-2",
        beatSelected && "bg-zinc-900/60",
      )}
      onClick={() =>
        onSelect({ type: "beat", sceneId, beatId: beat.id })
      }
    >
      <Textarea
        value={beat.action ?? ""}
        onChange={(e) => onUpdateBeat({ action: e.target.value })}
        placeholder="Action…"
        className="min-h-16 resize-y border-0 bg-transparent px-0 text-sm leading-relaxed text-zinc-300 shadow-none focus-visible:ring-0"
      />
      {beat.lines.map((line) => {
        const lineSelected =
          selection?.type === "line" && selection.lineId === line.id;
        return (
          <div
            key={line.id}
            className={cn(
              "mx-auto max-w-md space-y-1 text-center",
              lineSelected && "rounded-sm bg-zinc-800/80 py-2",
            )}
            onClick={(e) => {
              e.stopPropagation();
              onSelect({
                type: "line",
                sceneId,
                beatId: beat.id,
                lineId: line.id,
              });
            }}
          >
            <Input
              value={line.characterName}
              onChange={(e) =>
                onUpdateLine(line.id, { characterName: e.target.value })
              }
              className="border-0 bg-transparent text-center text-sm font-medium uppercase tracking-wider text-zinc-100 shadow-none focus-visible:ring-0"
            />
            <Input
              value={line.parenthetical ?? ""}
              onChange={(e) =>
                onUpdateLine(line.id, {
                  parenthetical: e.target.value || undefined,
                })
              }
              placeholder="(parenthetical)"
              className="border-0 bg-transparent text-center text-xs italic text-zinc-500 shadow-none focus-visible:ring-0"
            />
            <Textarea
              value={line.dialogue}
              onChange={(e) =>
                onUpdateLine(line.id, { dialogue: e.target.value })
              }
              placeholder="Dialogue…"
              className="min-h-14 resize-y border-0 bg-transparent text-center text-sm text-zinc-200 shadow-none focus-visible:ring-0"
            />
          </div>
        );
      })}
      <Button type="button" variant="ghost" size="sm" onClick={onAddLine}>
        Add dialogue
      </Button>
    </div>
  );
}

function AvBeat({
  beat,
  sceneId,
  selection,
  onSelect,
  onUpdateBeat,
  onUpdateLine,
  onAddLine,
}: BeatProps) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <div
        className="space-y-2 border border-zinc-800 p-3"
        onClick={() =>
          onSelect({ type: "beat", sceneId, beatId: beat.id })
        }
      >
        <p className="text-[10px] uppercase tracking-wider text-zinc-500">
          Video
        </p>
        <Textarea
          value={beat.action ?? ""}
          onChange={(e) => onUpdateBeat({ action: e.target.value })}
          placeholder="Visual description…"
          className="min-h-24 resize-y text-sm"
        />
      </div>
      <div className="space-y-3 border border-zinc-800 p-3">
        <p className="text-[10px] uppercase tracking-wider text-zinc-500">
          Audio
        </p>
        {beat.lines.map((line) => {
          const lineSelected =
            selection?.type === "line" && selection.lineId === line.id;
          return (
            <div
              key={line.id}
              className={cn(
                "space-y-1",
                lineSelected && "rounded-sm bg-zinc-900 p-2",
              )}
              onClick={(e) => {
                e.stopPropagation();
                onSelect({
                  type: "line",
                  sceneId,
                  beatId: beat.id,
                  lineId: line.id,
                });
              }}
            >
              <Input
                value={line.characterName}
                onChange={(e) =>
                  onUpdateLine(line.id, { characterName: e.target.value })
                }
                placeholder="Speaker"
                className="h-8 text-xs uppercase"
              />
              <Textarea
                value={line.dialogue}
                onChange={(e) =>
                  onUpdateLine(line.id, { dialogue: e.target.value })
                }
                placeholder="Dialogue / VO…"
                className="min-h-12 resize-y text-sm"
              />
              <Input
                value={line.audioNote ?? ""}
                onChange={(e) =>
                  onUpdateLine(line.id, {
                    audioNote: e.target.value || undefined,
                  })
                }
                placeholder="SFX / music note"
                className="h-8 text-xs text-zinc-400"
              />
            </div>
          );
        })}
        <Button type="button" variant="ghost" size="sm" onClick={onAddLine}>
          Add audio line
        </Button>
      </div>
    </div>
  );
}

export function useScriptDocument(
  initial: ScriptDocument | null | undefined,
  format: ScriptFormat = "screenplay",
) {
  const [document, setDocument] = useState<ScriptDocument>(() =>
    initial ?? createEmptyScript(format),
  );
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (initial) {
      setDocument(initial);
      setDirty(false);
    }
  }, [initial]);

  const setDoc = (doc: ScriptDocument) => {
    setDocument(doc);
    setDirty(true);
  };

  const runtime = estimateScriptRuntime(document);

  return { document, setDocument: setDoc, dirty, setDirty, runtime };
}

export function formatDuration(sec: number): string {
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return s === 0 ? `${m}m` : `${m}m ${s}s`;
}
