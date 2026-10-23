import { assertScriptDocument, withRuntimeEstimates } from "@cinakey/shared";
import { v } from "convex/values";
import { api, internal } from "../operations";
import type { Id } from "../../../../packages/backend/convex/_generated/dataModel";
import { action, type ActionCtx } from "../runtime/operation";
import { normalizeProposedScript } from "../../../../packages/backend/convex/lib/normalizeScriptProposal";
import { loadJson } from "../../../../packages/backend/convex/storage";

async function requireActionUser(ctx: ActionCtx) {
  const { getAuthUserId } = await import("@convex-dev/auth/server");
  const userId = await getAuthUserId(ctx);
  if (userId === null) throw new Error("Not authenticated");
  return userId as Id<"users">;
}

/**
 * Accept a proposal: materialize script / entities / rules.
 */
export const accept = action({
  args: {
    proposalId: v.id("proposals"),
    /** Optional edited payload override (from Edit-then-Accept). */
    payloadOverride: v.optional(v.any()),
  },
  handler: async (ctx, args): Promise<{ ok: true }> => {
    const userId = await requireActionUser(ctx);

    const proposal = await ctx.runQuery(internal.proposals.getInternal, {
      proposalId: args.proposalId,
    });
    if (!proposal) throw new Error("Proposal not found");
    await ctx.runQuery(internal.scriptVersions.assertAccess, {
      projectId: proposal.projectId,
      userId,
    });
    if (proposal.status !== "pending" && proposal.status !== "edited") {
      throw new Error("Proposal is not pending");
    }

    let payload = (args.payloadOverride ?? proposal.payload) as
      Record<string, unknown> | null | undefined;
    if (
      (payload === null || payload === undefined) &&
      proposal.payloadFileId !== undefined
    ) {
      payload = (await loadJson(ctx, proposal.payloadFileId)) as Record<
        string,
        unknown
      >;
    }
    if (payload === null || payload === undefined) {
      throw new Error("Proposal has no payload");
    }

    if (proposal.kind === "script_edit") {
      const document =
        normalizeProposedScript(payload.document) ??
        withRuntimeEstimates(assertScriptDocument(payload.document));
      await ctx.runAction(internal.scriptVersions.commitAsInternal, {
        projectId: proposal.projectId,
        userId,
        document,
        label: String(payload.summary ?? "Accepted script proposal"),
      });
    } else if (proposal.kind === "entities") {
      const entities = (payload.entities ?? []) as Array<{
        kind: "character" | "creature" | "location" | "prop";
        name: string;
        description?: string;
      }>;
      await ctx.runMutation(internal.proposals.applyEntities, {
        projectId: proposal.projectId,
        entities,
      });
    } else if (proposal.kind === "rules") {
      await ctx.runMutation(internal.proposals.applyRules, {
        projectId: proposal.projectId,
        add: payload.add as string[] | undefined,
        remove: payload.remove as string[] | undefined,
        replace: payload.replace as string[] | undefined,
      });
    } else if (proposal.kind === "character_details") {
      const fields = (payload.fields ?? {}) as Record<string, string>;
      let entityId = payload.entityId as Id<"entities"> | undefined;
      if (!entityId && typeof payload.entityName === "string") {
        const match = await ctx.runQuery(
          internal.proposals.findEntityByNameInternal,
          {
            projectId: proposal.projectId,
            kind: "character",
            name: payload.entityName,
          },
        );
        if (match === null) {
          throw new Error(
            `Character "${payload.entityName}" not found — open the sheet or create the entity first`,
          );
        }
        entityId = match._id;
      }
      if (!entityId) {
        throw new Error(
          "character_details proposal needs entityId or entityName",
        );
      }
      const sheetPatch: Record<string, string> = {};
      for (const key of [
        "look",
        "age",
        "build",
        "wardrobe",
        "personality",
        "voiceNotes",
      ] as const) {
        if (fields[key]) sheetPatch[key] = fields[key];
      }
      if (Object.keys(sheetPatch).length > 0) {
        await ctx.runAction(api.entities.saveSheet, {
          entityId,
          patch: sheetPatch,
        });
      }
      if (fields.description) {
        await ctx.runMutation(internal.proposals.patchEntityDescription, {
          entityId,
          description: fields.description,
        });
      }
    } else if (proposal.kind === "image_prompt") {
      let entityId = payload.entityId as Id<"entities"> | undefined;
      if (!entityId && typeof payload.entityName === "string") {
        const kinds = ["character", "location", "prop", "style"] as const;
        let found = null as { _id: Id<"entities"> } | null;
        for (const kind of kinds) {
          found = await ctx.runQuery(
            internal.proposals.findEntityByNameInternal,
            {
              projectId: proposal.projectId,
              kind,
              name: payload.entityName as string,
            },
          );
          if (found) break;
        }
        if (found === null) {
          throw new Error(
            `Entity "${payload.entityName}" not found for image prompt`,
          );
        }
        entityId = found._id;
      }
      if (!entityId) {
        throw new Error("image_prompt proposal needs entityId or entityName");
      }
      await ctx.runAction(api.entities.saveSheet, {
        entityId,
        patch: { draftPrompt: String(payload.prompt ?? "") },
      });
    } else if (proposal.kind === "shot_list") {
      const sceneElementId = String(payload.sceneElementId ?? "");
      if (!sceneElementId) {
        throw new Error("shot_list proposal needs sceneElementId");
      }
      const rawShots = (payload.shots ?? []) as Array<Record<string, unknown>>;
      await ctx.runMutation(internal.proposals.applyShotList, {
        projectId: proposal.projectId,
        sceneElementId,
        shots: rawShots.map((s) => ({
          shotType: String(s.shotType ?? "medium"),
          lensMm: typeof s.lensMm === "number" ? s.lensMm : undefined,
          cameraMove:
            typeof s.cameraMove === "string" ? s.cameraMove : undefined,
          durationSec: typeof s.durationSec === "number" ? s.durationSec : 3,
          characterNames: Array.isArray(s.characterNames)
            ? (s.characterNames as string[])
            : undefined,
          locationName:
            typeof s.locationName === "string" ? s.locationName : undefined,
          dialogueLineId:
            typeof s.dialogueLineId === "string" ? s.dialogueLineId : undefined,
          dialogue: typeof s.dialogue === "string" ? s.dialogue : undefined,
          notes: typeof s.notes === "string" ? s.notes : undefined,
        })),
      });
    } else if (proposal.kind === "story_treatment") {
      const document =
        normalizeProposedScript(payload.document) ??
        (payload.document
          ? withRuntimeEstimates(assertScriptDocument(payload.document))
          : null);
      if (document) {
        await ctx.runAction(internal.scriptVersions.commitAsInternal, {
          projectId: proposal.projectId,
          userId,
          document,
          label: String(payload.summary ?? "Story treatment"),
        });
      }
      if (typeof payload.logline === "string" && payload.logline.trim()) {
        await ctx.runMutation(internal.proposals.patchBriefLogline, {
          projectId: proposal.projectId,
          logline: payload.logline.trim(),
          audience:
            typeof payload.audience === "string" ? payload.audience : undefined,
          tone: typeof payload.tone === "string" ? payload.tone : undefined,
        });
      }
    } else if (proposal.kind === "asset_list") {
      const entities = (payload.entities ?? []) as Array<{
        kind: "character" | "creature" | "location" | "prop";
        name: string;
        description?: string;
      }>;
      await ctx.runMutation(internal.proposals.applyEntities, {
        projectId: proposal.projectId,
        entities,
      });
    } else if (proposal.kind === "style_block") {
      const artStyleBlock = String(payload.artStyleBlock ?? "").trim();
      if (!artStyleBlock) throw new Error("style_block needs artStyleBlock");
      const styleEntity = await ctx.runQuery(
        internal.proposals.findStyleEntityInternal,
        { projectId: proposal.projectId },
      );
      let entityId = styleEntity?._id;
      if (!entityId) {
        entityId = await ctx.runMutation(internal.proposals.ensureStyleEntity, {
          projectId: proposal.projectId,
        });
      }
      await ctx.runAction(api.entities.saveSheet, {
        entityId,
        patch: { artStyleBlock },
      });
      await ctx.runMutation(internal.promptSheets.markStyleStale, {
        projectId: proposal.projectId,
      });
    } else if (proposal.kind === "asset_sheet") {
      const type = String(payload.type ?? "") as
        "character" | "creature" | "environment" | "product";
      const structured = payload.structured;
      if (!structured) throw new Error("asset_sheet needs structured data");
      let entityId = payload.entityId as Id<"entities"> | undefined;
      if (!entityId && typeof payload.entityName === "string") {
        const kindMap = {
          character: "character",
          creature: "creature",
          environment: "location",
          product: "prop",
        } as const;
        const match = await ctx.runQuery(
          internal.proposals.findEntityByNameInternal,
          {
            projectId: proposal.projectId,
            kind: kindMap[type] ?? "character",
            name: payload.entityName as string,
          },
        );
        entityId = match?._id;
      }
      if (!entityId && typeof payload.entityName === "string") {
        // Create the Look Dev entity if the list step was skipped.
        const kindMap = {
          character: "character",
          creature: "creature",
          environment: "location",
          product: "prop",
        } as const;
        const createdIds = await ctx.runMutation(
          internal.proposals.applyEntities,
          {
            projectId: proposal.projectId,
            entities: [
              {
                kind: kindMap[type] ?? "character",
                name: payload.entityName as string,
              },
            ],
          },
        );
        entityId = createdIds[0];
      }
      if (!entityId) {
        throw new Error("asset_sheet needs entityId or entityName");
      }
      const created = await ctx.runAction(
        api.promptSheets.createOrUpdateDraft,
        {
          projectId: proposal.projectId,
          type,
          structured,
          entityId,
        },
      );
      // Keep Look Dev entity sheet in sync with the structured prompt sheet.
      const { lookDevPatchFromAssetSheet } = await import("@cinakey/shared");
      const lookDev = lookDevPatchFromAssetSheet(type, structured as never);
      if (Object.keys(lookDev.sheetPatch).length > 0) {
        await ctx.runAction(api.entities.saveSheet, {
          entityId,
          patch: lookDev.sheetPatch,
        });
      }
      if (lookDev.description) {
        await ctx.runMutation(internal.proposals.patchEntityDescription, {
          entityId,
          description: lookDev.description,
        });
      }
      if (payload.approveAndGenerate === true) {
        await ctx.runAction(api.promptSheets.approveAssetSheet, {
          promptSheetId: created.promptSheetId,
        });
      }
    } else if (proposal.kind === "script_prompt") {
      const structured = payload.structured;
      if (!structured) throw new Error("script_prompt needs structured data");
      const referenceMap = (payload.referenceMap ?? []) as Array<{
        imageN: number;
        entityId: Id<"entities">;
      }>;
      const created = await ctx.runAction(
        api.promptSheets.createOrUpdateDraft,
        {
          projectId: proposal.projectId,
          type: "script",
          structured,
          referenceMap,
          sourceAssetSheetIds: payload.sourceAssetSheetIds as
            Id<"promptSheets">[] | undefined,
          sequenceId: payload.sequenceId as Id<"sequences"> | undefined,
          replaceTipId: payload.replaceTipId as Id<"promptSheets"> | undefined,
        },
      );
      if (payload.applyShots !== false) {
        await ctx.runAction(api.sequences.applyScriptPrompt, {
          projectId: proposal.projectId,
          promptSheetId: created.promptSheetId,
          title:
            typeof payload.sequenceTitle === "string"
              ? payload.sequenceTitle
              : undefined,
        });
      }
    } else if (proposal.kind === "blockout_sheet") {
      const structured = payload.structured;
      if (!structured) throw new Error("blockout_sheet needs structured data");
      const created = await ctx.runAction(
        api.promptSheets.createOrUpdateDraft,
        {
          projectId: proposal.projectId,
          type: "blockout",
          structured,
          sequenceId: payload.sequenceId as Id<"sequences"> | undefined,
          sourceScriptPromptId: payload.sourceScriptPromptId as
            Id<"promptSheets"> | undefined,
          replaceTipId: payload.replaceTipId as Id<"promptSheets"> | undefined,
        },
      );
      if (payload.applyBlockout !== false) {
        await ctx.runAction(api.sequences.applyBlockoutSheet, {
          projectId: proposal.projectId,
          promptSheetId: created.promptSheetId,
        });
      }
    } else if (proposal.kind === "shot_prompt") {
      const shotId = payload.shotId as Id<"shots"> | undefined;
      const promptText =
        typeof payload.promptText === "string" ? payload.promptText.trim() : "";
      if (!shotId || !promptText) {
        throw new Error("shot_prompt needs shotId and promptText");
      }
      await ctx.runMutation(api.shotGeneration.setGenerationPromptOverride, {
        shotId,
        prompt: promptText,
      });
    } else if (proposal.kind === "generate_image") {
      const promptSheetId = payload.promptSheetId as
        Id<"promptSheets"> | undefined;
      if (!promptSheetId) {
        throw new Error("generate_image needs promptSheetId");
      }
      await ctx.runAction(api.promptSheets.approveAssetSheet, {
        promptSheetId,
      });
    } else if (proposal.kind === "generate_video") {
      const sequenceId = payload.sequenceId as Id<"sequences"> | undefined;
      if (!sequenceId) {
        throw new Error("generate_video needs sequenceId");
      }
      await ctx.runAction(api.shotGeneration.startSequenceGeneration, {
        sequenceId,
      });
    } else if (proposal.kind === "continuity") {
      const flags = Array.isArray(payload.flags) ? payload.flags : [];
      const body = [
        typeof payload.summary === "string" ? payload.summary : "Continuity",
        ...flags.map((f: { severity?: string; message?: string }) => {
          const sev = f.severity ? `[${f.severity}] ` : "";
          return `• ${sev}${f.message ?? ""}`;
        }),
      ]
        .filter(Boolean)
        .join("\n");
      const userId = await requireActionUser(ctx);
      await ctx.runMutation(internal.proposals.createContinuityNote, {
        projectId: proposal.projectId,
        shotId: payload.shotId as Id<"shots"> | undefined,
        takeId: payload.takeId as Id<"takes"> | undefined,
        body,
        authorId: userId,
      });
    }

    await ctx.runMutation(internal.proposals.markAccepted, {
      proposalId: args.proposalId,
    });

    return { ok: true as const };
  },
});

/** Resolve proposal payload (inline or from storage) for the UI. */
export const getResolvedPayload = action({
  args: { proposalId: v.id("proposals") },
  handler: async (ctx, args): Promise<Record<string, unknown> | null> => {
    const userId = await requireActionUser(ctx);
    const proposal = await ctx.runQuery(internal.proposals.getInternal, {
      proposalId: args.proposalId,
    });
    if (!proposal) throw new Error("Proposal not found");
    await ctx.runQuery(internal.scriptVersions.assertAccess, {
      projectId: proposal.projectId,
      userId,
    });
    if (proposal.payload !== undefined && proposal.payload !== null) {
      return proposal.payload as Record<string, unknown>;
    }
    if (proposal.payloadFileId !== undefined) {
      return (await loadJson(ctx, proposal.payloadFileId)) as Record<
        string,
        unknown
      >;
    }
    return null;
  },
});
