import { api } from "@cinakey/backend";
import {
  createEmptySheet,
  type SheetDocument,
} from "@cinakey/shared";
import { useAction, useMutation, useQuery } from "convex/react";
import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useCopilotContext } from "@/features/copilot/CopilotContext";
import { GenerationPanel } from "@/features/look-dev/GenerationPanel";
import {
  ExpressionSlots,
  HeroSlots,
  IdentitySlots,
  MoodSlots,
} from "@/features/look-dev/IdentitySlots";
import { ReferenceGallery } from "@/features/look-dev/ReferenceGallery";
import { SheetFields } from "@/features/look-dev/SheetFields";

export function EntitySheetPage() {
  const { projectId, entityId } = useParams();
  const entity = useQuery(
    api.entities.get,
    entityId ? { entityId: entityId as never } : "skip",
  );
  const getWithSheet = useAction(api.entities.getWithSheet);
  const saveSheet = useAction(api.entities.saveSheet);
  const updateEntity = useMutation(api.entities.update);
  const { setContext } = useCopilotContext();

  const [sheet, setSheet] = useState<SheetDocument | null>(null);
  const [styleSheet, setStyleSheet] = useState<SheetDocument | null>(null);
  const [lockedUrls, setLockedUrls] = useState<Record<string, string | null>>(
    {},
  );
  const [projectRules, setProjectRules] = useState<string[]>([]);
  const [description, setDescription] = useState("");
  const [name, setName] = useState("");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [editTarget, setEditTarget] = useState<{
    assetId: string;
    url: string;
  } | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const reload = useCallback(async () => {
    if (!entityId) return;
    setLoadError(null);
    try {
      const result = await getWithSheet({ entityId: entityId as never });
      setSheet(result.sheet);
      setStyleSheet(result.styleSheet);
      setLockedUrls(result.lockedUrls);
      setProjectRules(result.projectRules);
      setDescription(result.entity.description ?? "");
      setName(result.entity.name);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Failed to load sheet");
      setSheet(createEmptySheet("character"));
    }
  }, [entityId, getWithSheet]);

  useEffect(() => {
    void reload();
  }, [reload, reloadKey]);

  useEffect(() => {
    if (projectId && entityId) {
      setContext({
        view: "look-dev",
        projectId,
        selectionIds: [entityId],
      });
    }
  }, [projectId, entityId, setContext]);

  async function persistSheet(next: SheetDocument) {
    if (!entityId) return;
    setSaving(true);
    try {
      const { look, age, build, wardrobe, personality, voiceNotes, notes, palette, lighting, lensLook, filmGrain, mood, draftPrompt } =
        next;
      await saveSheet({
        entityId: entityId as never,
        patch: {
          look,
          age,
          build,
          wardrobe,
          personality,
          voiceNotes,
          notes,
          palette,
          lighting,
          lensLook,
          filmGrain,
          mood,
          draftPrompt,
        },
      });
      setReloadKey((k) => k + 1);
    } finally {
      setSaving(false);
    }
  }

  function onFieldChange(patch: Partial<SheetDocument>) {
    setSheet((prev) => (prev ? { ...prev, ...patch } : prev));
  }

  async function onBlurSave() {
    if (!sheet || !entityId) return;
    setSaving(true);
    try {
      await updateEntity({
        entityId: entityId as never,
        name: name.trim() || undefined,
        description,
      });
      await persistSheet(sheet);
    } finally {
      setSaving(false);
    }
  }

  if (!projectId || !entityId) return null;

  if (entity === undefined || sheet === null) {
    return (
      <div className="p-6 text-sm text-zinc-500">
        {loadError ?? "Loading sheet…"}
      </div>
    );
  }

  if (entity === null) {
    return (
      <div className="p-6 text-sm text-red-400">Entity not found</div>
    );
  }

  return (
    <div className="space-y-8 p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-2">
          <Link
            to={`/projects/${projectId}/look-dev`}
            className="text-xs text-zinc-500 hover:text-zinc-300"
          >
            ← Look Dev
          </Link>
          <div className="flex flex-wrap items-center gap-3">
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              onBlur={() => void onBlurSave()}
              className="h-9 max-w-xs text-lg font-semibold"
            />
            <span className="rounded border border-zinc-700 px-2 py-0.5 text-xs uppercase tracking-wider text-zinc-500">
              {entity.kind}
            </span>
            {saving ? (
              <span className="text-xs text-zinc-500">Saving…</span>
            ) : null}
          </div>
        </div>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          onClick={() => setReloadKey((k) => k + 1)}
        >
          Refresh
        </Button>
      </div>

      <section className="space-y-3">
        <h3 className="text-sm font-medium text-zinc-200">Description</h3>
        <SheetFields
          sheet={sheet}
          description={description}
          onDescriptionChange={setDescription}
          onFieldChange={onFieldChange}
          onBlurSave={() => void onBlurSave()}
        />
      </section>

      {sheet.entityKind === "character" ? (
        <>
          <IdentitySlots
            entityId={entityId}
            sheet={sheet}
            lockedUrls={lockedUrls}
            onChanged={() => setReloadKey((k) => k + 1)}
          />
          <ExpressionSlots
            entityId={entityId}
            sheet={sheet}
            lockedUrls={lockedUrls}
            onChanged={() => setReloadKey((k) => k + 1)}
          />
        </>
      ) : null}

      {sheet.entityKind === "location" || sheet.entityKind === "prop" ? (
        <HeroSlots
          entityId={entityId}
          sheet={sheet}
          lockedUrls={lockedUrls}
          onChanged={() => setReloadKey((k) => k + 1)}
        />
      ) : null}

      {sheet.entityKind === "style" ? (
        <MoodSlots
          entityId={entityId}
          sheet={sheet}
          lockedUrls={lockedUrls}
          onChanged={() => setReloadKey((k) => k + 1)}
        />
      ) : null}

      <GenerationPanel
        projectId={projectId}
        entityId={entityId}
        entityName={name}
        entityDescription={description}
        sheet={sheet}
        styleSheet={
          sheet.entityKind === "style" ? sheet : styleSheet
        }
        projectRules={projectRules}
        editTarget={editTarget}
        onClearEditTarget={() => setEditTarget(null)}
        onJobStarted={() => setReloadKey((k) => k + 1)}
        onDraftSaved={(draftPrompt) => {
          setSheet((prev) => (prev ? { ...prev, draftPrompt } : prev));
          void saveSheet({
            entityId: entityId as never,
            patch: { draftPrompt },
          });
        }}
      />

      <ReferenceGallery
        projectId={projectId}
        entityId={entityId}
        sheet={sheet}
        onChanged={() => setReloadKey((k) => k + 1)}
        onSelectForEdit={(assetId, url) => setEditTarget({ assetId, url })}
      />
    </div>
  );
}
