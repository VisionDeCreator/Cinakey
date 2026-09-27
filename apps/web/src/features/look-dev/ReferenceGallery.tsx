import { api } from "@cinakey/backend";
import {
  IDENTITY_SLOT_KEYS,
  IDENTITY_SLOT_LABELS,
  type IdentitySlotKey,
  type SheetDocument,
} from "@cinakey/shared";
import { useAction, useQuery } from "convex/react";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { useAssetUpload } from "@/features/assets/useAssetUpload";

type Props = {
  projectId: string;
  entityId: string;
  sheet: SheetDocument;
  onChanged: () => void;
  onSelectForEdit: (assetId: string, url: string) => void;
};

export function ReferenceGallery({
  projectId,
  entityId,
  sheet,
  onChanged,
  onSelectForEdit,
}: Props) {
  const assets = useQuery(api.entities.listAssetsForEntity, {
    entityId: entityId as never,
  });
  const lock = useAction(api.entities.lockReference);
  const { uploads, uploadFiles } = useAssetUpload(projectId);
  const fileRef = useRef<HTMLInputElement>(null);
  const [containsLikeness, setContainsLikeness] = useState(false);
  const [likenessConsent, setLikenessConsent] = useState(false);
  const [locking, setLocking] = useState<string | null>(null);
  const [exprLabel, setExprLabel] = useState("Smile");

  // Resolve URLs via individual queries would be N+1; use getAssetUrl per item in AssetThumb
  async function handleUpload(files: FileList | null) {
    if (!files || files.length === 0) return;
    await uploadFiles(files, {
      entityId,
      containsLikeness,
      likenessConsent: containsLikeness ? likenessConsent : undefined,
    });
    onChanged();
  }

  async function lockAs(
    assetId: string,
    mode:
      | { type: "slot"; slot: IdentitySlotKey }
      | { type: "hero" }
      | { type: "mood" }
      | { type: "expression"; label: string },
  ) {
    setLocking(assetId);
    try {
      if (mode.type === "slot") {
        await lock({
          entityId: entityId as never,
          assetId: assetId as never,
          slot: mode.slot,
        });
      } else if (mode.type === "hero") {
        await lock({
          entityId: entityId as never,
          assetId: assetId as never,
        });
      } else if (mode.type === "mood") {
        await lock({
          entityId: entityId as never,
          assetId: assetId as never,
          moodReference: true,
        });
      } else {
        await lock({
          entityId: entityId as never,
          assetId: assetId as never,
          expressionLabel: mode.label,
        });
      }
      onChanged();
    } finally {
      setLocking(null);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-sm font-medium text-zinc-200">Reference gallery</h3>
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-xs text-zinc-400">
            <input
              type="checkbox"
              checked={containsLikeness}
              onChange={(e) => setContainsLikeness(e.target.checked)}
            />
            Real person&apos;s face
          </label>
          {containsLikeness ? (
            <label className="flex items-center gap-2 text-xs text-amber-400/90">
              <input
                type="checkbox"
                checked={likenessConsent}
                onChange={(e) => setLikenessConsent(e.target.checked)}
              />
              I have likeness consent
            </label>
          ) : null}
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={(e) => void handleUpload(e.target.files)}
          />
          <Button
            type="button"
            size="sm"
            variant="secondary"
            disabled={containsLikeness && !likenessConsent}
            onClick={() => fileRef.current?.click()}
          >
            Import photo
          </Button>
        </div>
      </div>

      {uploads.some((u) => u.status === "uploading") ? (
        <p className="text-xs text-zinc-500">Uploading…</p>
      ) : null}
      {uploads
        .filter((u) => u.status === "error")
        .map((u) => (
          <p key={u.id} className="text-xs text-red-400">
            {u.name}: {u.error}
          </p>
        ))}

      {sheet.entityKind === "character" ? (
        <div className="flex items-center gap-2 text-xs text-zinc-500">
          <Label htmlFor="expr-label" className="text-xs">
            Expression label
          </Label>
          <input
            id="expr-label"
            className="h-7 w-28 rounded border border-zinc-700 bg-zinc-950 px-2"
            value={exprLabel}
            onChange={(e) => setExprLabel(e.target.value)}
          />
        </div>
      ) : null}

      {assets === undefined ? (
        <p className="text-sm text-zinc-600">Loading gallery…</p>
      ) : assets.length === 0 ? (
        <p className="text-sm text-zinc-600">
          No images yet. Generate or import references.
        </p>
      ) : (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {assets.map((asset) => (
            <GalleryItem
              key={asset._id}
              assetId={asset._id}
              name={asset.name}
              sheet={sheet}
              locking={locking === asset._id}
              onLockSlot={(slot) =>
                void lockAs(asset._id, { type: "slot", slot })
              }
              onLockHero={() => void lockAs(asset._id, { type: "hero" })}
              onLockMood={() => void lockAs(asset._id, { type: "mood" })}
              onLockExpression={() =>
                void lockAs(asset._id, {
                  type: "expression",
                  label: exprLabel.trim() || "Expression",
                })
              }
              onEdit={(url) => onSelectForEdit(asset._id, url)}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function GalleryItem({
  assetId,
  name,
  sheet,
  locking,
  onLockSlot,
  onLockHero,
  onLockMood,
  onLockExpression,
  onEdit,
}: {
  assetId: string;
  name: string;
  sheet: SheetDocument;
  locking: boolean;
  onLockSlot: (slot: IdentitySlotKey) => void;
  onLockHero: () => void;
  onLockMood: () => void;
  onLockExpression: () => void;
  onEdit: (url: string) => void;
}) {
  const url = useQuery(api.storage.getAssetUrl, {
    assetId: assetId as never,
  });

  return (
    <li className="overflow-hidden border border-zinc-800 bg-zinc-950">
      <div className="aspect-square bg-zinc-900">
        {url ? (
          <img src={url} alt={name} className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full items-center justify-center text-xs text-zinc-600">
            …
          </div>
        )}
      </div>
      <div className="space-y-2 p-2">
        <p className="truncate text-xs text-zinc-400">{name}</p>
        <div className="flex flex-wrap gap-1">
          {sheet.entityKind === "character"
            ? IDENTITY_SLOT_KEYS.map((slot) => (
                <Button
                  key={slot}
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="h-6 px-1.5 text-[10px]"
                  disabled={locking}
                  onClick={() => onLockSlot(slot)}
                >
                  {IDENTITY_SLOT_LABELS[slot]}
                </Button>
              ))
            : null}
          {sheet.entityKind === "character" ? (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-6 px-1.5 text-[10px]"
              disabled={locking}
              onClick={onLockExpression}
            >
              Expr
            </Button>
          ) : null}
          {sheet.entityKind === "location" || sheet.entityKind === "prop" ? (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-6 px-1.5 text-[10px]"
              disabled={locking}
              onClick={onLockHero}
            >
              Lock hero
            </Button>
          ) : null}
          {sheet.entityKind === "style" ? (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-6 px-1.5 text-[10px]"
              disabled={locking}
              onClick={onLockMood}
            >
              Lock mood
            </Button>
          ) : null}
          {url ? (
            <Button
              type="button"
              size="sm"
              variant="secondary"
              className="h-6 px-1.5 text-[10px]"
              onClick={() => onEdit(url)}
            >
              Edit mask
            </Button>
          ) : null}
        </div>
      </div>
    </li>
  );
}
