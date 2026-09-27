import { api } from "@cinakey/backend";
import {
  IDENTITY_SLOT_KEYS,
  IDENTITY_SLOT_LABELS,
  type IdentitySlotKey,
  type SheetDocument,
} from "@cinakey/shared";
import { useAction, useQuery } from "convex/react";
import { Button } from "@/components/ui/button";

type Props = {
  entityId: string;
  sheet: SheetDocument;
  lockedUrls: Record<string, string | null>;
  onChanged: () => void;
};

function SlotThumb({
  label,
  assetId,
  url,
  onUnlock,
}: {
  label: string;
  assetId?: string;
  url?: string | null;
  onUnlock: () => void;
}) {
  return (
    <div className="space-y-2">
      <p className="text-xs uppercase tracking-wider text-zinc-500">{label}</p>
      <div className="relative aspect-square overflow-hidden border border-zinc-800 bg-zinc-950">
        {assetId && url ? (
          <img src={url} alt={label} className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full items-center justify-center text-xs text-zinc-600">
            Empty
          </div>
        )}
      </div>
      {assetId ? (
        <Button type="button" size="sm" variant="ghost" onClick={onUnlock}>
          Unlock
        </Button>
      ) : null}
    </div>
  );
}

export function IdentitySlots({
  entityId,
  sheet,
  lockedUrls,
  onChanged,
}: Props) {
  const unlock = useAction(api.entities.unlockReference);

  async function unlockSlot(slot: IdentitySlotKey) {
    await unlock({ entityId: entityId as never, slot });
    onChanged();
  }

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-medium text-zinc-200">Identity set</h3>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {IDENTITY_SLOT_KEYS.map((slot) => {
          const assetId = sheet.identitySlots?.[slot];
          return (
            <SlotThumb
              key={slot}
              label={IDENTITY_SLOT_LABELS[slot]}
              assetId={assetId}
              url={assetId ? lockedUrls[assetId] : null}
              onUnlock={() => void unlockSlot(slot)}
            />
          );
        })}
      </div>
    </div>
  );
}

export function HeroSlots({
  entityId,
  sheet,
  lockedUrls,
  onChanged,
}: Props) {
  const unlock = useAction(api.entities.unlockReference);
  const heroes = sheet.heroAssetIds ?? [];

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-medium text-zinc-200">Locked hero images</h3>
      {heroes.length === 0 ? (
        <p className="text-sm text-zinc-600">
          Lock images from the gallery below.
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {heroes.map((assetId) => (
            <SlotThumb
              key={assetId}
              label="Hero"
              assetId={assetId}
              url={lockedUrls[assetId]}
              onUnlock={() => {
                void unlock({
                  entityId: entityId as never,
                  heroAssetId: assetId as never,
                }).then(onChanged);
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export function MoodSlots({
  entityId,
  sheet,
  lockedUrls,
  onChanged,
}: Props) {
  const unlock = useAction(api.entities.unlockReference);
  const moods = sheet.moodReferenceAssetIds ?? [];
  const assets = useQuery(api.entities.listAssetsForEntity, {
    entityId: entityId as never,
  });

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-medium text-zinc-200">Mood references</h3>
      {moods.length === 0 ? (
        <p className="text-sm text-zinc-600">
          Lock mood images from the gallery.
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {moods.map((assetId) => {
            const fromGallery = assets?.find((a) => a._id === assetId);
            return (
              <SlotThumb
                key={assetId}
                label={fromGallery?.name ?? "Mood"}
                assetId={assetId}
                url={lockedUrls[assetId]}
                onUnlock={() => {
                  void unlock({
                    entityId: entityId as never,
                    moodAssetId: assetId as never,
                  }).then(onChanged);
                }}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}

export function ExpressionSlots({
  entityId,
  sheet,
  lockedUrls,
  onChanged,
}: Props) {
  const unlock = useAction(api.entities.unlockReference);
  const expressions = sheet.expressionSlots ?? [];

  if (expressions.length === 0) return null;

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-medium text-zinc-200">Expressions</h3>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {expressions.map((expr) => (
          <SlotThumb
            key={expr.label}
            label={expr.label}
            assetId={expr.assetId}
            url={lockedUrls[expr.assetId]}
            onUnlock={() => {
              void unlock({
                entityId: entityId as never,
                expressionLabel: expr.label,
              }).then(onChanged);
            }}
          />
        ))}
      </div>
    </div>
  );
}
