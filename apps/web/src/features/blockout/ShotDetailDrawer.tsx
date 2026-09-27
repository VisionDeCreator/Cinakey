import { api } from "@cinakey/backend";
import { useAction, useMutation, useQuery } from "convex/react";
import { Box } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { KeyframePanel } from "@/features/blockout/KeyframePanel";
import {
  CAMERA_MOVES,
  SHOT_STATUSES,
  SHOT_TYPES,
  type ShotStatusValue,
} from "@/features/blockout/shotConstants";

type ShotRow = {
  _id: string;
  shotType: string;
  lensMm?: number;
  cameraMove?: string;
  durationSec: number;
  characterIds: string[];
  locationId?: string;
  dialogueLineId?: string;
  dialogue?: string;
  status: ShotStatusValue;
  outdated: boolean;
  notes?: string;
  keyframeUrl: string | null;
  blockoutFileId?: string;
};

type DialogueLine = {
  id: string;
  characterName: string;
  dialogue: string;
};

type Props = {
  projectId: string;
  sceneId: string;
  sceneElementId: string | null;
  shot: ShotRow | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function ShotDetailDrawer({
  projectId,
  sceneId,
  sceneElementId,
  shot,
  open,
  onOpenChange,
}: Props) {
  const update = useMutation(api.shots.update);
  const getContent = useAction(api.scriptVersions.getContent);
  const entities = useQuery(api.entities.listForProject, {
    projectId: projectId as never,
  });

  const [saving, setSaving] = useState(false);
  const [dialogueLines, setDialogueLines] = useState<DialogueLine[]>([]);

  useEffect(() => {
    if (!open || !sceneElementId) return;
    let cancelled = false;
    void getContent({ projectId: projectId as never })
      .then((result) => {
        if (cancelled || !result.document) return;
        const scene = result.document.scenes.find(
          (s) => s.id === sceneElementId,
        );
        if (!scene) return;
        const lines: DialogueLine[] = [];
        for (const beat of scene.beats) {
          for (const line of beat.lines) {
            lines.push({
              id: line.id,
              characterName: line.characterName,
              dialogue: line.dialogue,
            });
          }
        }
        setDialogueLines(lines);
      })
      .catch(() => {
        /* ignore */
      });
    return () => {
      cancelled = true;
    };
  }, [open, sceneElementId, projectId, getContent]);

  if (!shot) return null;

  const characters = (entities ?? []).filter((e) => e.kind === "character");
  const locations = (entities ?? []).filter((e) => e.kind === "location");

  async function patch(fields: Record<string, unknown>) {
    setSaving(true);
    try {
      await update({ shotId: shot!._id as never, ...fields });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-md">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            Shot detail
            {shot.outdated ? (
              <span className="rounded bg-amber-500/20 px-1.5 py-0.5 text-[10px] font-normal uppercase tracking-wide text-amber-400">
                Out of date
              </span>
            ) : null}
          </SheetTitle>
        </SheetHeader>

        <div className="mt-4 space-y-4">
          <Button asChild variant="secondary" size="sm" className="w-full">
            <Link to={`/projects/${projectId}/blockout/shots/${shot._id}`}>
              <Box />
              {shot.blockoutFileId ? "Open 3D blockout" : "Create 3D blockout"}
            </Link>
          </Button>
          <KeyframePanel
            projectId={projectId}
            sceneId={sceneId}
            shotId={shot._id}
            keyframeUrl={shot.keyframeUrl}
          />

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Shot type</Label>
              <Select
                value={shot.shotType}
                onValueChange={(v) => void patch({ shotType: v })}
              >
                <SelectTrigger className="h-8">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {[
                    ...SHOT_TYPES,
                    ...(SHOT_TYPES.includes(shot.shotType as never)
                      ? []
                      : [shot.shotType]),
                  ].map((t) => (
                    <SelectItem key={t} value={t}>
                      {t}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Lens (mm)</Label>
              <Input
                type="number"
                className="h-8"
                defaultValue={shot.lensMm ?? ""}
                key={`lens-${shot._id}-${shot.lensMm ?? "x"}`}
                onBlur={(e) => {
                  const n = e.target.value ? Number(e.target.value) : null;
                  void patch({ lensMm: n });
                }}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Camera move</Label>
              <Select
                value={shot.cameraMove ?? "static"}
                onValueChange={(v) => void patch({ cameraMove: v })}
              >
                <SelectTrigger className="h-8">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {[
                    ...CAMERA_MOVES,
                    ...(shot.cameraMove &&
                    !CAMERA_MOVES.includes(shot.cameraMove as never)
                      ? [shot.cameraMove]
                      : []),
                  ].map((m) => (
                    <SelectItem key={m} value={m}>
                      {m}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Duration (s)</Label>
              <Input
                type="number"
                step="0.5"
                min={0.5}
                className="h-8"
                defaultValue={shot.durationSec}
                key={`dur-${shot._id}-${shot.durationSec}`}
                onBlur={(e) => {
                  const n = Number(e.target.value);
                  if (!Number.isNaN(n)) void patch({ durationSec: n });
                }}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Status</Label>
              <Select
                value={shot.status}
                onValueChange={(v) => void patch({ status: v })}
              >
                <SelectTrigger className="h-8">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SHOT_STATUSES.map((s) => (
                    <SelectItem key={s.value} value={s.value}>
                      {s.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Location</Label>
              <Select
                value={shot.locationId ?? "__none__"}
                onValueChange={(v) =>
                  void patch({
                    locationId: v === "__none__" ? null : v,
                  })
                }
              >
                <SelectTrigger className="h-8">
                  <SelectValue placeholder="None" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">None</SelectItem>
                  {locations.map((l) => (
                    <SelectItem key={l._id} value={l._id}>
                      {l.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1">
            <Label className="text-xs">Characters</Label>
            <div className="flex flex-wrap gap-1.5">
              {characters.map((c) => {
                const on = shot.characterIds.includes(c._id);
                return (
                  <Button
                    key={c._id}
                    type="button"
                    size="sm"
                    variant={on ? "default" : "outline"}
                    className="h-7 text-xs"
                    disabled={saving}
                    onClick={() => {
                      const next = on
                        ? shot.characterIds.filter((id) => id !== c._id)
                        : [...shot.characterIds, c._id];
                      void patch({ characterIds: next });
                    }}
                  >
                    {c.name}
                  </Button>
                );
              })}
              {characters.length === 0 ? (
                <p className="text-xs text-zinc-500">No characters yet</p>
              ) : null}
            </div>
          </div>

          <div className="space-y-1">
            <Label className="text-xs">Linked dialogue</Label>
            <Select
              value={shot.dialogueLineId ?? "__none__"}
              onValueChange={(v) => {
                if (v === "__none__") {
                  void patch({ dialogueLineId: null, dialogue: null });
                  return;
                }
                const line = dialogueLines.find((l) => l.id === v);
                void patch({
                  dialogueLineId: v,
                  dialogue: line?.dialogue ?? null,
                });
              }}
            >
              <SelectTrigger className="h-8">
                <SelectValue placeholder="None" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">None</SelectItem>
                {dialogueLines.map((l) => (
                  <SelectItem key={l.id} value={l.id}>
                    {l.characterName}: {l.dialogue.slice(0, 48)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1">
            <Label className="text-xs">Notes</Label>
            <Textarea
              className="min-h-16 text-sm"
              defaultValue={shot.notes ?? ""}
              key={`notes-${shot._id}-${shot.notes ?? ""}`}
              onBlur={(e) => {
                const v = e.target.value.trim();
                void patch({ notes: v.length === 0 ? null : v });
              }}
            />
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
