import {
  MANNEQUIN_POSES,
  type BlockoutNode,
  type BlockoutTransform,
  type MannequinPose,
  type Vec3,
} from "@cinakey/shared";
import { Trash2 } from "lucide-react";
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
import { useTime, type TimeStore } from "./timeStore";

const UNTAGGED = "__none__";
const LENS_PRESETS = [18, 24, 28, 35, 50, 85, 135];

type Props = {
  node: BlockoutNode | null;
  timeStore: TimeStore;
  getTransform: (nodeId: string) => BlockoutTransform | null;
  animated: boolean;
  lensMm: number;
  durationSec: number;
  fps: number;
  aspectRatio: string;
  characters: Array<{ id: string; name: string }>;
  onTransform: (nodeId: string, t: BlockoutTransform) => void;
  onPatch: (nodeId: string, patch: Partial<BlockoutNode>) => void;
  onLens: (lensMm: number) => void;
  onDelete: (nodeId: string) => void;
};

function NumberField({
  value,
  onCommit,
  step = 0.1,
}: {
  value: number;
  onCommit: (n: number) => void;
  step?: number;
}) {
  const shown = Math.round(value * 100) / 100;
  return (
    <Input
      key={shown}
      type="number"
      step={step}
      defaultValue={shown}
      className="h-7 px-1.5 text-xs tabular-nums"
      onBlur={(e) => {
        const n = Number(e.target.value);
        if (Number.isFinite(n) && n !== shown) onCommit(n);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
      }}
    />
  );
}

function VecRow({
  label,
  value,
  onCommit,
  degrees,
}: {
  label: string;
  value: Vec3;
  onCommit: (v: Vec3) => void;
  degrees?: boolean;
}) {
  const toUi = (n: number) => (degrees ? (n * 180) / Math.PI : n);
  const fromUi = (n: number) => (degrees ? (n * Math.PI) / 180 : n);
  return (
    <div className="grid gap-1">
      <Label className="text-[10px] uppercase tracking-wider text-zinc-500">{label}</Label>
      <div className="grid grid-cols-3 gap-1">
        {[0, 1, 2].map((i) => (
          <NumberField
            key={i}
            value={toUi(value[i]!)}
            step={degrees ? 5 : 0.1}
            onCommit={(n) => {
              const next = [...value] as Vec3;
              next[i] = fromUi(n);
              onCommit(next);
            }}
          />
        ))}
      </div>
    </div>
  );
}

export function EditorInspector({
  node,
  timeStore,
  getTransform,
  animated,
  lensMm,
  durationSec,
  fps,
  aspectRatio,
  characters,
  onTransform,
  onPatch,
  onLens,
  onDelete,
}: Props) {
  useTime(timeStore);
  const lensField = (
    <div className="grid gap-1">
      <Label className="text-[10px] uppercase tracking-wider text-zinc-500">Lens (mm)</Label>
      <div className="flex gap-1">
        <NumberField value={lensMm} step={1} onCommit={(n) => n > 0 && onLens(n)} />
        <Select value={String(lensMm)} onValueChange={(v) => onLens(Number(v))}>
          <SelectTrigger className="h-7 w-20 text-xs">
            <SelectValue placeholder="Preset" />
          </SelectTrigger>
          <SelectContent>
            {LENS_PRESETS.map((l) => (
              <SelectItem key={l} value={String(l)}>
                {l}mm
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );

  if (!node) {
    return (
      <div className="grid gap-4 p-3 text-xs text-zinc-400">
        <p className="text-sm text-zinc-200">Shot</p>
        <dl className="grid grid-cols-2 gap-y-1">
          <dt>Duration</dt>
          <dd className="text-zinc-200">{durationSec}s</dd>
          <dt>Frame rate</dt>
          <dd className="text-zinc-200">{fps} fps</dd>
          <dt>Aspect</dt>
          <dd className="text-zinc-200">{aspectRatio}</dd>
        </dl>
        {lensField}
        <p className="leading-relaxed text-zinc-500">
          Click an object to select it. W / E / R switch move, rotate and scale. Space plays, K
          sets a keyframe.
        </p>
      </div>
    );
  }

  const t = getTransform(node.id) ?? node.transform;
  const commit = (patch: Partial<BlockoutTransform>) => onTransform(node.id, { ...t, ...patch });
  const deletable = node.kind !== "camera" && node.kind !== "ground";

  return (
    <div className="grid gap-4 p-3">
      <div className="grid gap-1">
        <Label className="text-[10px] uppercase tracking-wider text-zinc-500">{node.kind}</Label>
        <Input
          key={node.id}
          defaultValue={node.name}
          className="h-8 text-sm"
          onBlur={(e) => {
            const name = e.target.value.trim();
            if (name && name !== node.name) onPatch(node.id, { name });
          }}
        />
        {animated ? (
          <p className="text-[11px] text-amber-400">
            Animated: edits set a keyframe at the playhead.
          </p>
        ) : null}
      </div>

      {node.kind !== "ground" ? (
        <>
          <VecRow label="Position (m)" value={t.position} onCommit={(position) => commit({ position })} />
          <VecRow label="Rotation (°)" value={t.rotation} degrees onCommit={(rotation) => commit({ rotation })} />
          {node.kind !== "camera" && node.kind !== "light" ? (
            <VecRow label="Scale" value={t.scale} onCommit={(scale) => commit({ scale })} />
          ) : null}
        </>
      ) : null}

      {node.kind === "camera" ? lensField : null}

      {node.kind === "mannequin" ? (
        <>
          <div className="grid gap-1">
            <Label className="text-[10px] uppercase tracking-wider text-zinc-500">Pose</Label>
            <Select value={node.pose ?? "standing"} onValueChange={(v) => onPatch(node.id, { pose: v as MannequinPose })}>
              <SelectTrigger className="h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {MANNEQUIN_POSES.map((p) => (
                  <SelectItem key={p} value={p}>
                    {p[0]!.toUpperCase() + p.slice(1)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1">
            <Label className="text-[10px] uppercase tracking-wider text-zinc-500">Character</Label>
            <Select
              value={node.entityId ?? UNTAGGED}
              onValueChange={(v) => {
                const c = characters.find((x) => x.id === v);
                onPatch(node.id, c ? { entityId: c.id, name: c.name } : { entityId: undefined });
              }}
            >
              <SelectTrigger className="h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={UNTAGGED}>Untagged</SelectItem>
                {characters.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1">
            <Label className="text-[10px] uppercase tracking-wider text-zinc-500">Action</Label>
            <Input
              key={`${node.id}-action`}
              defaultValue={node.action ?? ""}
              placeholder="e.g. walks to the door"
              className="h-8 text-xs"
              onBlur={(e) => {
                const action = e.target.value.trim();
                if (action !== (node.action ?? "")) onPatch(node.id, { action: action || undefined });
              }}
            />
          </div>
        </>
      ) : null}

      {node.kind === "light" ? (
        <div className="grid gap-1">
          <Label className="text-[10px] uppercase tracking-wider text-zinc-500">Intensity</Label>
          <NumberField
            value={node.intensity ?? { key: 2.4, fill: 0.8, back: 1.4 }[node.lightRole ?? "key"]}
            onCommit={(n) => onPatch(node.id, { intensity: Math.max(0, n) })}
          />
        </div>
      ) : null}

      {node.kind === "prop" || node.kind === "set" || node.kind === "mannequin" ? (
        <div className="grid gap-1">
          <Label className="text-[10px] uppercase tracking-wider text-zinc-500">Colour</Label>
          <input
            type="color"
            value={node.color ?? (node.kind === "set" ? "#71717a" : node.kind === "prop" ? "#a1a1aa" : "#e07a5f")}
            onChange={(e) => onPatch(node.id, { color: e.target.value })}
            className="h-8 w-full cursor-pointer border border-zinc-700 bg-transparent"
          />
        </div>
      ) : null}

      {deletable ? (
        <Button type="button" variant="ghost" size="sm" className="justify-start text-red-300" onClick={() => onDelete(node.id)}>
          <Trash2 />
          Delete
        </Button>
      ) : null}
    </div>
  );
}
