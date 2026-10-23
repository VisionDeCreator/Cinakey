import {
  assembleLookDevPrompt,
  assertSheetDocument,
  type SheetDocument,
} from "@cinakey/shared";
import { api, internal } from "../operations";
import type {
  Doc,
  Id,
} from "../../../../packages/backend/convex/_generated/dataModel";
import { action, type ActionCtx } from "../runtime/operation";
import {
  isAssetSheetType,
  renderPromptSheetText,
  validateStructured,
} from "../../../../packages/backend/convex/lib/promptRender";
import { loadJson } from "../../../../packages/backend/convex/storage";
import { saveJson } from "./storage";

const INLINE_RENDERED_MAX = 80_000;

const sheetTypeForKind: Record<
  string,
  "character" | "creature" | "environment" | "product" | null
> = {
  character: "character",
  creature: "creature",
  location: "environment",
  prop: "product",
  style: null,
};

async function resolveRenderedText(
  ctx: ActionCtx,
  tip: Doc<"promptSheets"> | undefined,
  entity: Doc<"entities">,
  artStyle: string,
): Promise<string | null> {
  if (tip) {
    if (tip.renderedText?.trim()) return tip.renderedText;
    if (tip.renderedFileId) {
      try {
        return String(await loadJson(ctx, tip.renderedFileId));
      } catch {
        /* fall through */
      }
    }
    if (tip.structuredFileId) {
      try {
        const structured = await loadJson(ctx, tip.structuredFileId);
        if (isAssetSheetType(tip.type)) {
          const validated = validateStructured(tip.type, structured);
          if (validated.ok) {
            return renderPromptSheetText(tip.type, validated.data, artStyle);
          }
        }
      } catch {
        /* fall through */
      }
    }
  }

  if (!entity.sheetFileId) return null;
  try {
    const sheet = assertSheetDocument(
      await loadJson(ctx, entity.sheetFileId),
    ) as SheetDocument;
    if (sheet.draftPrompt?.trim()) return sheet.draftPrompt;
    return (
      assembleLookDevPrompt({
        entitySheet: sheet,
        entityName: entity.name,
        entityDescription: entity.description,
      }) || null
    );
  } catch {
    return null;
  }
}

/**
 * Phase 11A: ensure every creative entity has a tip prompt sheet with
 * rendered text; copy style mood ref → projects.styleReferenceAssetId.
 * Run: `npx convex run migrations:migratePhase11A`
 */
export const migratePhase11A = action({
  args: {},
  handler: async (ctx) => {
    const projects: Doc<"projects">[] = await ctx.runQuery(
      internal.migrations.listProjectsInternal,
      {},
    );

    let entitiesMigrated = 0;
    let tipsCreated = 0;
    let styleRefsCopied = 0;
    let skipped = 0;

    for (const project of projects) {
      const entities: Doc<"entities">[] = await ctx.runQuery(
        internal.migrations.listEntitiesForProjectInternal,
        { projectId: project._id },
      );
      const tips: Doc<"promptSheets">[] = await ctx.runQuery(
        internal.migrations.listTipSheetsInternal,
        { projectId: project._id },
      );

      let artStyle = "";
      const styleEntity = entities.find((e) => e.kind === "style");
      if (styleEntity?.sheetFileId) {
        try {
          const styleSheet = assertSheetDocument(
            await loadJson(ctx, styleEntity.sheetFileId),
          ) as SheetDocument;
          artStyle = styleSheet.artStyleBlock?.trim() ?? "";
          const moodRef = styleSheet.moodReferenceAssetIds?.[0];
          if (project.styleReferenceAssetId === undefined && moodRef) {
            await ctx.runMutation(
              internal.migrations.patchStyleReferenceInternal,
              {
                projectId: project._id,
                styleReferenceAssetId: moodRef as Id<"assets">,
              },
            );
            styleRefsCopied += 1;
          }
        } catch {
          /* ignore */
        }
      }

      for (const entity of entities) {
        if (entity.kind === "style") continue;
        const sheetType = sheetTypeForKind[entity.kind];
        if (!sheetType) continue;

        const existingTip = tips.find(
          (t) => t.entityId === entity._id && isAssetSheetType(t.type),
        );

        if (existingTip?.renderedText?.trim() || existingTip?.renderedFileId) {
          skipped += 1;
          continue;
        }

        const text = await resolveRenderedText(
          ctx,
          existingTip,
          entity,
          artStyle,
        );
        if (!text?.trim()) {
          skipped += 1;
          continue;
        }

        const stub = {
          schema: "cinakey.prompt/custom/1",
          type: sheetType,
          customPrompt: true,
          migratedFrom: "phase11a",
        };
        const { storageId: structuredFileId } = await saveJson(ctx, stub);
        let renderedText: string | undefined = text;
        let renderedFileId: Id<"_storage"> | undefined;
        if (text.length > INLINE_RENDERED_MAX) {
          const stored = await saveJson(ctx, text);
          renderedFileId = stored.storageId;
          renderedText = undefined;
        }

        await ctx.runMutation(internal.migrations.insertMigratedTipInternal, {
          projectId: project._id,
          type: sheetType,
          entityId: entity._id,
          structuredFileId,
          renderedText,
          renderedFileId,
          demoteTipId: existingTip?._id,
          parentId: existingTip?._id,
          version: existingTip ? existingTip.version + 1 : 1,
        });
        tipsCreated += 1;
        entitiesMigrated += 1;
      }
    }

    return { entitiesMigrated, tipsCreated, styleRefsCopied, skipped };
  },
});

/**
 * Phase 11B: ensure script tips have rendered text; wire sequences as parts;
 * backfill shot timings / sequenceId; mark blockout tips stale.
 * Run: `npx convex run migrations:migratePhase11B`
 */
export const migratePhase11B = action({
  args: {},
  handler: async (ctx) => {
    const {
      parseScriptPromptText,
      renderScriptPrompt,
      scriptPromptSchema,
      scriptShotFingerprint,
    } = await import("@cinakey/shared");

    const projects: Doc<"projects">[] = await ctx.runQuery(
      internal.migrations.listProjectsInternal,
      {},
    );

    let scriptsEnsured = 0;
    let sequencesCreated = 0;
    let shotsPatched = 0;
    let blockoutsStaled = 0;

    for (const project of projects) {
      const tips: Doc<"promptSheets">[] = await ctx.runQuery(
        internal.migrations.listTipSheetsInternal,
        { projectId: project._id },
      );
      const sequences = await ctx.runQuery(
        internal.migrations.listSequencesInternal,
        {
          projectId: project._id,
        },
      );

      const scriptTips = tips.filter((t) => t.type === "script");

      for (const tip of scriptTips) {
        let rendered = tip.renderedText?.trim() ?? "";
        if (!rendered && tip.renderedFileId) {
          try {
            rendered = String(await loadJson(ctx, tip.renderedFileId));
          } catch {
            /* ignore */
          }
        }
        if (!rendered && tip.structuredFileId) {
          try {
            const structured = scriptPromptSchema.parse(
              await loadJson(ctx, tip.structuredFileId),
            );
            rendered = renderScriptPrompt(structured);
            const stored = await saveJson(ctx, rendered);
            await ctx.runMutation(
              internal.migrations.patchScriptTipRenderedInternal,
              {
                promptSheetId: tip._id,
                renderedText:
                  rendered.length <= INLINE_RENDERED_MAX ? rendered : undefined,
                renderedFileId:
                  rendered.length > INLINE_RENDERED_MAX
                    ? stored.storageId
                    : undefined,
              },
            );
            scriptsEnsured += 1;
          } catch {
            /* ignore */
          }
        } else if (rendered) {
          scriptsEnsured += 1;
        }

        // Ensure sequence linked
        if (!tip.sequenceId && sequences.length === 0) {
          const seqId = await ctx.runMutation(
            internal.migrations.ensureSequenceForScriptInternal,
            {
              projectId: project._id,
              scriptPromptId: tip._id,
              title: "Part 1",
              durationSec: 30,
            },
          );
          sequencesCreated += 1;
          await ctx.runMutation(internal.sequences.linkSequenceOnSheet, {
            promptSheetId: tip._id,
            sequenceId: seqId,
          });
        } else if (!tip.sequenceId && sequences[0]) {
          await ctx.runMutation(internal.sequences.linkSequenceOnSheet, {
            promptSheetId: tip._id,
            sequenceId: sequences[0]._id,
          });
          await ctx.runMutation(
            internal.migrations.patchSequenceScriptInternal,
            {
              sequenceId: sequences[0]._id,
              scriptPromptId: tip._id,
            },
          );
        }
      }

      // Backfill shot timings from script tips
      const seqsAfter = await ctx.runQuery(
        internal.migrations.listSequencesInternal,
        { projectId: project._id },
      );
      for (const seq of seqsAfter) {
        if (!seq.scriptPromptId) continue;
        const tip = await ctx.runQuery(internal.promptSheets.getInternal, {
          promptSheetId: seq.scriptPromptId,
        });
        if (!tip) continue;
        let text = tip.renderedText?.trim() ?? "";
        if (!text && tip.renderedFileId) {
          try {
            text = String(await loadJson(ctx, tip.renderedFileId));
          } catch {
            continue;
          }
        }
        if (!text) continue;
        let parsed;
        try {
          parsed = parseScriptPromptText(text);
        } catch {
          continue;
        }
        const n = await ctx.runMutation(
          internal.migrations.backfillSequenceShotsInternal,
          {
            sequenceId: seq._id,
            projectId: project._id,
            shots: parsed.shots.map((s) => ({
              n: s.n,
              shotType: s.shotType,
              cameraMove: s.cameraMove,
              startSec: s.startSec,
              endSec: s.endSec,
              durationSec: s.endSec - s.startSec,
              notes: s.action,
              scriptLineKey: scriptShotFingerprint({
                n: s.n,
                startSec: s.startSec,
                endSec: s.endSec,
                shotType: s.shotType,
                cameraMove: s.cameraMove,
                action: s.action,
              }),
            })),
          },
        );
        shotsPatched += n;
      }

      // Mark blockout tips out_of_date
      for (const tip of tips.filter((t) => t.type === "blockout")) {
        if (tip.status !== "out_of_date" && tip.status !== "draft") {
          await ctx.runMutation(internal.promptSheets.patchStatus, {
            promptSheetId: tip._id,
            status: "out_of_date",
          });
          blockoutsStaled += 1;
        }
      }

      // If no script tip but has shots — create a skeleton part
      if (scriptTips.length === 0) {
        const shots = await ctx.runQuery(
          internal.migrations.listShotsInternal,
          {
            projectId: project._id,
          },
        );
        if (shots.length > 0) {
          let seqId = seqsAfter[0]?._id;
          if (!seqId) {
            seqId = await ctx.runMutation(
              internal.migrations.ensureSequenceForScriptInternal,
              {
                projectId: project._id,
                title: "Part 1",
                durationSec: Math.min(
                  30,
                  shots.reduce((a, s) => a + s.durationSec, 0) || 30,
                ),
              },
            );
            sequencesCreated += 1;
          }
          const skeleton = [
            "REFERENCES",
            "@image_1 = style. Use it for the project art style.",
            "",
            "ART STYLE — LOCKED TO THE REFERENCE IMAGES:",
            "Use the exact art style already defined in @image_1.",
            "",
            "IMAGE QUALITY — ALWAYS SHARP AND CLEAN:",
            "Every frame sharp.",
            "",
            "LOCATION — @image_1: Location TBD.",
            "",
            `SHOTS (${Math.min(30, shots.reduce((a, s) => a + s.durationSec, 0) || 5)} seconds total, multi-shot, 16:9):`,
            ...shots.slice(0, 24).map((s, i) => {
              const start = shots
                .slice(0, i)
                .reduce((a, x) => a + x.durationSec, 0);
              const end = start + s.durationSec;
              return `Shot ${i + 1} (${start}s–${end}s) — ${s.shotType}${s.cameraMove ? `, ${s.cameraMove}` : ""}: ${s.notes ?? s.dialogue ?? "action"}`;
            }),
            "",
            "CONSISTENCY:",
            "Keep characters consistent.",
            "",
            "MOTION AND PHYSICS:",
            "Natural motion.",
            "",
            "LIGHTING:",
            "Natural light.",
            "",
            "TECHNICAL:",
            "16:9, 24fps.",
            "",
            "MUSIC:",
            "Score TBD.",
            "",
            "AUDIO (native sound, synced to picture, no dialogue):",
            "0.0s ambient.",
          ].join("\n");
          const stub = {
            schema: "cinakey.prompt/script/1",
            customPrompt: true,
          };
          const structuredStore = await saveJson(ctx, stub);
          const renderedStore = await saveJson(ctx, skeleton);
          await ctx.runMutation(internal.migrations.insertScriptTipInternal, {
            projectId: project._id,
            sequenceId: seqId,
            structuredFileId: structuredStore.storageId,
            renderedFileId: renderedStore.storageId,
            renderedText:
              skeleton.length <= INLINE_RENDERED_MAX ? skeleton : undefined,
          });
          scriptsEnsured += 1;
        }
      }
    }

    return {
      scriptsEnsured,
      sequencesCreated,
      shotsPatched,
      blockoutsStaled,
    };
  },
});

/**
 * Phase 11D: assemble legacy per-shot cinakey.blockout/1.0 files into
 * sequences.blockoutFileId (cinakey.blockout/2.0).
 * Run: `npx convex run migrations:migratePhase11D`
 */
export const migratePhase11D = action({
  args: {},
  handler: async (ctx) => {
    const { migrateShotsToPartDocument } = await import("@cinakey/shared");
    type MigrateShotMeta = import("@cinakey/shared").MigrateShotMeta;
    type BlockoutDocumentV1 = import("@cinakey/shared").BlockoutDocumentV1;

    const projects: Doc<"projects">[] = await ctx.runQuery(
      internal.migrations.listProjectsInternal,
      {},
    );

    let sequencesMigrated = 0;
    let skipped = 0;

    for (const project of projects) {
      const sequences = await ctx.runQuery(
        internal.migrations.listSequencesInternal,
        { projectId: project._id },
      );
      for (const seq of sequences) {
        if (seq.blockoutFileId) {
          skipped += 1;
          continue;
        }
        const pairs: Array<{
          doc: BlockoutDocumentV1;
          meta: MigrateShotMeta;
        }> = [];
        for (const shotId of seq.shotIds) {
          const shot = await ctx.runQuery(internal.sequences.getShotInternal, {
            shotId,
          });
          if (!shot?.blockoutFileId) continue;
          try {
            const raw = await loadJson(ctx, shot.blockoutFileId);
            if (
              (raw as { schema?: string })?.schema !== "cinakey.blockout/1.0"
            ) {
              continue;
            }
            const startSec = shot.startSec ?? 0;
            const endSec = shot.endSec ?? startSec + shot.durationSec;
            pairs.push({
              doc: raw as BlockoutDocumentV1,
              meta: {
                id: shot._id,
                order: shot.order,
                startSec,
                endSec,
                durationSec: shot.durationSec,
                shotType: shot.shotType,
                notes: shot.notes,
                lensMm: shot.lensMm,
                cameraMove: shot.cameraMove,
              },
            });
          } catch {
            /* skip */
          }
        }
        if (pairs.length === 0) {
          skipped += 1;
          continue;
        }
        const document = migrateShotsToPartDocument(
          pairs,
          {
            id: project._id,
            title: project.title,
            aspectRatio: project.aspectRatio,
            fps: project.fps,
          },
          seq._id,
        );
        await ctx.runAction(api.blockouts.saveForSequence, {
          sequenceId: seq._id,
          document,
        });
        sequencesMigrated += 1;
      }
    }

    return { sequencesMigrated, skipped };
  },
});
