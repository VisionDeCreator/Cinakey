import { api } from "@cinakey/backend";
import {
  createEmptySheet,
  type SheetDocument,
} from "@cinakey/shared";
import { useAction, useMutation, useQuery } from "convex/react";
import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
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
  const autofillSheet = useAction(api.entities.autofillSheet);
  const updateEntity = useMutation(api.entities.update);
  const autofillCost = useQuery(api.entities.estimateAutofillCost);
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
  const [autofillOpen, setAutofillOpen] = useState(false);
  const [autofilling, setAutofilling] = useState(false);
  const [autofillError, setAutofillError] = useState<string | null>(null);
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
      const {
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
        artStyleBlock,
      } = next;
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
          artStyleBlock,
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

  async function runAutofill() {
    if (!entityId) return;
    setAutofilling(true);
    setAutofillError(null);
    try {
      const result = await autofillSheet({ entityId: entityId as never });
      setSheet(result.sheet);
      if (result.description !== undefined) {
        setDescription(result.description);
      }
      setAutofillOpen(false);
      setReloadKey((k) => k + 1);
    } catch (err) {
      setAutofillError(err instanceof Error ? err.message : "Auto-fill failed");
    } finally {
      setAutofilling(false);
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

  const canAutofill =
    sheet.entityKind === "character" ||
    sheet.entityKind === "creature" ||
    sheet.entityKind === "location" ||
    sheet.entityKind === "prop";
  const creditEstimate = autofillCost?.credits ?? 2;
  const autofillFieldBlurb =
    sheet.entityKind === "location" || sheet.entityKind === "prop"
      ? "This drafts the summary and notes from your story and script."
      : "This drafts look, age, build, wardrobe, personality, and voice notes from your story and script.";

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
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-medium text-zinc-200">Description</h3>
          {canAutofill ? (
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={() => {
                setAutofillError(null);
                setAutofillOpen(true);
              }}
            >
              Auto-fill with AI
            </Button>
          ) : null}
        </div>
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

      <AlertDialog open={autofillOpen} onOpenChange={setAutofillOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Auto-fill sheet with AI?</AlertDialogTitle>
            <AlertDialogDescription>
              {autofillFieldBlurb} It uses about{" "}
              <span className="text-zinc-200">{creditEstimate} credits</span>{" "}
              (DeepSeek). Existing field text will be overwritten.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {autofillError ? (
            <p className="text-sm text-red-400">{autofillError}</p>
          ) : null}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={autofilling}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={autofilling}
              onClick={(e) => {
                e.preventDefault();
                void runAutofill();
              }}
            >
              {autofilling
                ? "Filling…"
                : `Use ${creditEstimate} credits & fill`}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
