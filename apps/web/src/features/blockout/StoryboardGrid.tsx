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
  rectSortingStrategy,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { api } from "@cinakey/backend";
import { useMutation } from "convex/react";
import type { ShotListItem } from "@/features/blockout/ShotListTable";

type Props = {
  sceneId: string;
  shots: ShotListItem[];
  onOpenShot: (shotId: string) => void;
};

function SortableCard({
  shot,
  onOpen,
}: {
  shot: ShotListItem;
  onOpen: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: shot._id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.75 : 1,
  };

  return (
    <button
      type="button"
      ref={setNodeRef}
      style={style}
      className="group flex flex-col overflow-hidden border border-zinc-800 bg-zinc-950 text-left transition hover:border-zinc-600"
      onClick={onOpen}
      {...attributes}
      {...listeners}
    >
      <div className="aspect-video bg-zinc-900">
        {shot.selectedTakeThumbUrl ? (
          <video
            src={shot.selectedTakeThumbUrl}
            className="h-full w-full object-cover"
            muted
            playsInline
          />
        ) : shot.keyframeUrl ? (
          <img
            src={shot.keyframeUrl}
            alt=""
            className="h-full w-full object-cover"
            draggable={false}
          />
        ) : (
          <div className="flex h-full items-center justify-center text-[10px] text-zinc-600">
            No keyframe
          </div>
        )}
      </div>
      <div className="flex items-start justify-between gap-1 px-2 py-1.5">
        <div className="min-w-0">
          <p className="truncate text-[11px] text-zinc-200">
            {shot.order + 1}. {shot.shotType}
            {shot.lensMm ? ` · ${shot.lensMm}mm` : ""}
          </p>
          <p className="truncate text-[10px] text-zinc-500">
            {shot.cameraMove ?? "static"} · {shot.durationSec}s
          </p>
        </div>
        <div className="flex shrink-0 gap-1">
          {shot.blockoutFileId ? (
            <span className="rounded bg-sky-500/20 px-1 text-[9px] uppercase text-sky-300">
              3D
            </span>
          ) : null}
          {shot.outdated ? (
            <span className="rounded bg-amber-500/20 px-1 text-[9px] uppercase text-amber-400">
              Stale
            </span>
          ) : null}
        </div>
      </div>
    </button>
  );
}

export function StoryboardGrid({ sceneId, shots, onOpenShot }: Props) {
  const reorder = useMutation(api.shots.reorder);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
  );

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

  if (shots.length === 0) {
    return (
      <p className="py-12 text-center text-sm text-zinc-500">
        No shots to storyboard yet.
      </p>
    );
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={(e) => void onDragEnd(e)}
    >
      <SortableContext
        items={shots.map((s) => s._id)}
        strategy={rectSortingStrategy}
      >
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {shots.map((shot) => (
            <SortableCard
              key={shot._id}
              shot={shot}
              onOpen={() => onOpenShot(shot._id)}
            />
          ))}
        </div>
      </SortableContext>
    </DndContext>
  );
}
