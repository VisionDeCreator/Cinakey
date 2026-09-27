import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { api } from "@cinakey/backend";
import { useMutation, useQuery } from "convex/react";
import { GripVertical } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  CAMERA_MOVES,
  SHOT_STATUSES,
  SHOT_TYPES,
  type ShotStatusValue,
} from "@/features/blockout/shotConstants";

export type ShotListItem = {
  _id: string;
  order: number;
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

type Props = {
  projectId: string;
  sceneId: string;
  shots: ShotListItem[];
  onOpenShot: (shotId: string) => void;
};

function SortableRow({
  shot,
  entityName,
  onOpen,
  onPatch,
  onSplit,
  onMergeNext,
  canMerge,
}: {
  shot: ShotListItem;
  entityName: (id: string) => string;
  onOpen: () => void;
  onPatch: (fields: Record<string, unknown>) => void;
  onSplit: () => void;
  onMergeNext: () => void;
  canMerge: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: shot._id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.7 : 1,
  };

  return (
    <tr
      ref={setNodeRef}
      style={style}
      className="border-b border-zinc-800/80 hover:bg-zinc-900/40"
    >
      <td className="w-8 px-1 py-1.5">
        <button
          type="button"
          className="cursor-grab touch-none p-1 text-zinc-500 hover:text-zinc-300"
          aria-label="Drag to reorder"
          {...attributes}
          {...listeners}
        >
          <GripVertical className="h-3.5 w-3.5" />
        </button>
      </td>
      <td className="px-1 py-1.5 text-center text-[11px] text-zinc-500">
        {shot.order + 1}
      </td>
      <td className="px-1 py-1.5">
        <Select
          value={shot.shotType}
          onValueChange={(v) => onPatch({ shotType: v })}
        >
          <SelectTrigger className="h-7 min-w-[7rem] text-[11px]">
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
      </td>
      <td className="px-1 py-1.5">
        <Input
          type="number"
          className="h-7 w-16 text-[11px]"
          defaultValue={shot.lensMm ?? ""}
          key={`l-${shot._id}-${shot.lensMm ?? "x"}`}
          onBlur={(e) => {
            const n = e.target.value ? Number(e.target.value) : null;
            onPatch({ lensMm: n });
          }}
        />
      </td>
      <td className="px-1 py-1.5">
        <Select
          value={shot.cameraMove ?? "static"}
          onValueChange={(v) => onPatch({ cameraMove: v })}
        >
          <SelectTrigger className="h-7 min-w-[6rem] text-[11px]">
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
      </td>
      <td className="px-1 py-1.5">
        <Input
          type="number"
          step="0.5"
          min={0.5}
          className="h-7 w-14 text-[11px]"
          defaultValue={shot.durationSec}
          key={`d-${shot._id}-${shot.durationSec}`}
          onBlur={(e) => {
            const n = Number(e.target.value);
            if (!Number.isNaN(n)) onPatch({ durationSec: n });
          }}
        />
      </td>
      <td className="max-w-[8rem] truncate px-1 py-1.5 text-[11px] text-zinc-400">
        {shot.characterIds.map(entityName).join(", ") || "—"}
      </td>
      <td className="max-w-[6rem] truncate px-1 py-1.5 text-[11px] text-zinc-400">
        {shot.locationId ? entityName(shot.locationId) : "—"}
      </td>
      <td className="max-w-[10rem] px-1 py-1.5 text-[11px] text-zinc-400">
        <div className="flex items-center gap-1">
          {shot.outdated ? (
            <span className="shrink-0 rounded bg-amber-500/20 px-1 text-[9px] uppercase tracking-wide text-amber-400">
              Out of date
            </span>
          ) : null}
          <span className="truncate">{shot.dialogue ?? "—"}</span>
        </div>
      </td>
      <td className="px-1 py-1.5">
        <Select
          value={shot.status}
          onValueChange={(v) => onPatch({ status: v })}
        >
          <SelectTrigger className="h-7 min-w-[6.5rem] text-[11px]">
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
      </td>
      <td className="px-1 py-1.5">
        <div className="flex flex-wrap gap-1">
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-6 px-1.5 text-[10px]"
            onClick={onOpen}
          >
            Open
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-6 px-1.5 text-[10px]"
            onClick={onSplit}
          >
            Split
          </Button>
          {canMerge ? (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-6 px-1.5 text-[10px]"
              onClick={onMergeNext}
            >
              Merge↓
            </Button>
          ) : null}
        </div>
      </td>
    </tr>
  );
}

export function ShotListTable({
  projectId,
  sceneId,
  shots,
  onOpenShot,
}: Props) {
  const update = useMutation(api.shots.update);
  const reorder = useMutation(api.shots.reorder);
  const split = useMutation(api.shots.split);
  const merge = useMutation(api.shots.merge);
  const entities = useQuery(api.entities.listForProject, {
    projectId: projectId as never,
  });

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  );

  const nameById = new Map(
    (entities ?? []).map((e: { _id: string; name: string }) => [
      e._id,
      e.name,
    ]),
  );
  const entityName = (id: string): string => nameById.get(id) ?? "…";

  async function onDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = shots.findIndex((s) => s._id === active.id);
    const newIndex = shots.findIndex((s) => s._id === over.id);
    if (oldIndex < 0 || newIndex < 0) return;
    const next = arrayMove(shots, oldIndex, newIndex);
    await reorder({
      sceneId: sceneId as never,
      orderedShotIds: next.map((s) => s._id as never),
    });
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={(e) => void onDragEnd(e)}
    >
      <div className="overflow-x-auto">
        <table className="w-full min-w-[56rem] border-collapse text-left">
          <thead>
            <tr className="border-b border-zinc-700 text-[10px] uppercase tracking-wider text-zinc-500">
              <th className="w-8 px-1 py-2" />
              <th className="px-1 py-2">#</th>
              <th className="px-1 py-2">Type</th>
              <th className="px-1 py-2">Lens</th>
              <th className="px-1 py-2">Move</th>
              <th className="px-1 py-2">Dur</th>
              <th className="px-1 py-2">Characters</th>
              <th className="px-1 py-2">Location</th>
              <th className="px-1 py-2">Dialogue</th>
              <th className="px-1 py-2">Status</th>
              <th className="px-1 py-2">Actions</th>
            </tr>
          </thead>
          <SortableContext
            items={shots.map((s) => s._id)}
            strategy={verticalListSortingStrategy}
          >
            <tbody>
              {shots.map((shot, i) => (
                <SortableRow
                  key={shot._id}
                  shot={shot}
                  entityName={entityName}
                  onOpen={() => onOpenShot(shot._id)}
                  onPatch={(fields) =>
                    void update({ shotId: shot._id as never, ...fields })
                  }
                  onSplit={() => void split({ shotId: shot._id as never })}
                  onMergeNext={() => {
                    const next = shots[i + 1];
                    if (!next) return;
                    void merge({
                      firstShotId: shot._id as never,
                      secondShotId: next._id as never,
                    });
                  }}
                  canMerge={i < shots.length - 1}
                />
              ))}
            </tbody>
          </SortableContext>
        </table>
        {shots.length === 0 ? (
          <p className="py-8 text-center text-sm text-zinc-500">
            No shots yet — ask the copilot for a shot list, or add one below.
          </p>
        ) : null}
      </div>
    </DndContext>
  );
}
