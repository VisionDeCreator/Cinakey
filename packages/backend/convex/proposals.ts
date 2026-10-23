import { normalizeEntityName } from "@cinakey/shared";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { internalMutation, internalQuery, mutation } from "./_generated/server";
import { requireProjectAccess, requireUser } from "./lib/access";

export const reject = mutation({
  args: { proposalId: v.id("proposals") },
  handler: async (ctx, args) => {
    await requireUser(ctx);
    const proposal = await ctx.db.get(args.proposalId);
    if (proposal === null) throw new Error("Proposal not found");
    await requireProjectAccess(ctx, proposal.projectId);
    if (proposal.status !== "pending" && proposal.status !== "edited") {
      throw new Error("Proposal is not pending");
    }
    await ctx.db.patch(args.proposalId, {
      status: "rejected",
      resolvedAt: Date.now(),
    });
  },
});

export const updatePayload = mutation({
  args: {
    proposalId: v.id("proposals"),
    payload: v.any(),
  },
  handler: async (ctx, args) => {
    await requireUser(ctx);
    const proposal = await ctx.db.get(args.proposalId);
    if (proposal === null) throw new Error("Proposal not found");
    await requireProjectAccess(ctx, proposal.projectId);
    if (proposal.status !== "pending" && proposal.status !== "edited") {
      throw new Error("Proposal is not pending");
    }
    await ctx.db.patch(args.proposalId, {
      payload: args.payload,
      status: "edited",
    });
  },
});

export const markAccepted = internalMutation({
  args: { proposalId: v.id("proposals") },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.proposalId, {
      status: "accepted",
      resolvedAt: Date.now(),
    });
  },
});

export const applyEntities = internalMutation({
  args: {
    projectId: v.id("projects"),
    entities: v.array(
      v.object({
        kind: v.union(
          v.literal("character"),
          v.literal("creature"),
          v.literal("location"),
          v.literal("prop"),
        ),
        name: v.string(),
        description: v.optional(v.string()),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("entities")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .collect();
    const now = Date.now();
    const ids: Id<"entities">[] = [];

    for (const ent of args.entities) {
      const key = `${ent.kind}:${normalizeEntityName(ent.name)}`;
      const found = existing.find(
        (e) => `${e.kind}:${normalizeEntityName(e.name)}` === key,
      );
      if (found) {
        await ctx.db.patch(found._id, {
          name: ent.name.trim(),
          description: ent.description ?? found.description,
          updatedAt: now,
        });
        ids.push(found._id);
      } else {
        const id = await ctx.db.insert("entities", {
          projectId: args.projectId,
          kind: ent.kind,
          name: ent.name.trim(),
          description: ent.description,
          lockedReferenceAssetIds: [],
          createdAt: now,
          updatedAt: now,
        });
        ids.push(id);
      }
    }
    return ids;
  },
});

export const applyRules = internalMutation({
  args: {
    projectId: v.id("projects"),
    add: v.optional(v.array(v.string())),
    remove: v.optional(v.array(v.string())),
    replace: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    const project = await ctx.db.get(args.projectId);
    if (project === null) throw new Error("Project not found");

    let rules = [...project.rules];
    if (args.replace !== undefined) {
      rules = args.replace.map((r) => r.trim()).filter(Boolean);
    } else {
      if (args.remove) {
        const removeSet = new Set(
          args.remove.map((r) => r.trim().toLowerCase()),
        );
        rules = rules.filter((r) => !removeSet.has(r.trim().toLowerCase()));
      }
      if (args.add) {
        for (const r of args.add) {
          const trimmed = r.trim();
          if (!trimmed) continue;
          if (
            !rules.some((x) => x.trim().toLowerCase() === trimmed.toLowerCase())
          ) {
            rules.push(trimmed);
          }
        }
      }
    }
    await ctx.db.patch(args.projectId, { rules, updatedAt: Date.now() });
    return rules;
  },
});

export const findEntityByNameInternal = internalQuery({
  args: {
    projectId: v.id("projects"),
    kind: v.union(
      v.literal("character"),
      v.literal("creature"),
      v.literal("location"),
      v.literal("prop"),
      v.literal("style"),
    ),
    name: v.string(),
  },
  handler: async (ctx, args) => {
    const entities = await ctx.db
      .query("entities")
      .withIndex("by_project_kind", (q) =>
        q.eq("projectId", args.projectId).eq("kind", args.kind),
      )
      .collect();
    const key = normalizeEntityName(args.name);
    return entities.find((e) => normalizeEntityName(e.name) === key) ?? null;
  },
});

export const applyShotList = internalMutation({
  args: {
    projectId: v.id("projects"),
    sceneElementId: v.string(),
    shots: v.array(
      v.object({
        shotType: v.string(),
        lensMm: v.optional(v.number()),
        cameraMove: v.optional(v.string()),
        durationSec: v.number(),
        characterNames: v.optional(v.array(v.string())),
        locationName: v.optional(v.string()),
        dialogueLineId: v.optional(v.string()),
        dialogue: v.optional(v.string()),
        notes: v.optional(v.string()),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const scene = await ctx.db
      .query("scenes")
      .withIndex("by_project_element", (q) =>
        q.eq("projectId", args.projectId).eq("elementId", args.sceneElementId),
      )
      .unique();
    if (scene === null) {
      throw new Error(
        `Scene with elementId "${args.sceneElementId}" not found — commit a script first`,
      );
    }

    const entities = await ctx.db
      .query("entities")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .collect();

    const resolveCharacterIds = (
      names: string[] | undefined,
    ): Id<"entities">[] => {
      if (!names || names.length === 0) return [];
      const ids: Id<"entities">[] = [];
      for (const name of names) {
        const key = normalizeEntityName(name);
        const found = entities.find(
          (e) => e.kind === "character" && normalizeEntityName(e.name) === key,
        );
        if (found) ids.push(found._id);
      }
      return ids;
    };

    const resolveLocationId = (
      name: string | undefined,
    ): Id<"entities"> | undefined => {
      if (!name) return undefined;
      const key = normalizeEntityName(name);
      return entities.find(
        (e) => e.kind === "location" && normalizeEntityName(e.name) === key,
      )?._id;
    };

    const existing = await ctx.db
      .query("shots")
      .withIndex("by_scene", (q) => q.eq("sceneId", scene._id))
      .collect();
    for (const s of existing) {
      await ctx.db.delete(s._id);
    }

    const now = Date.now();
    const ids: Id<"shots">[] = [];
    for (let i = 0; i < args.shots.length; i++) {
      const def = args.shots[i]!;
      const id = await ctx.db.insert("shots", {
        projectId: args.projectId,
        sceneId: scene._id,
        order: i,
        shotType: String(def.shotType).trim() || "medium",
        lensMm: def.lensMm,
        cameraMove: def.cameraMove,
        durationSec: Math.max(0.5, Number(def.durationSec) || 3),
        characterIds: resolveCharacterIds(def.characterNames),
        locationId: resolveLocationId(def.locationName),
        dialogueLineId: def.dialogueLineId,
        dialogue: def.dialogue,
        status: "planned",
        outdated: false,
        notes: def.notes,
        createdAt: now,
        updatedAt: now,
      });
      ids.push(id);
    }
    return { sceneId: scene._id, shotIds: ids, replaced: existing.length };
  },
});

export const patchEntityDescription = internalMutation({
  args: {
    entityId: v.id("entities"),
    description: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.entityId, {
      description: args.description,
      updatedAt: Date.now(),
    });
  },
});

export const getInternal = internalQuery({
  args: { proposalId: v.id("proposals") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.proposalId);
  },
});

export const patchBriefLogline = internalMutation({
  args: {
    projectId: v.id("projects"),
    logline: v.string(),
    audience: v.optional(v.string()),
    tone: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const project = await ctx.db.get(args.projectId);
    if (project === null) throw new Error("Project not found");
    await ctx.db.patch(args.projectId, {
      brief: {
        logline: args.logline,
        audience: args.audience ?? project.brief?.audience,
        tone: args.tone ?? project.brief?.tone,
      },
      updatedAt: Date.now(),
    });
  },
});

export const findStyleEntityInternal = internalQuery({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("entities")
      .withIndex("by_project_kind", (q) =>
        q.eq("projectId", args.projectId).eq("kind", "style"),
      )
      .first();
  },
});

export const ensureStyleEntity = internalMutation({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("entities")
      .withIndex("by_project_kind", (q) =>
        q.eq("projectId", args.projectId).eq("kind", "style"),
      )
      .first();
    if (existing) return existing._id;
    const now = Date.now();
    return await ctx.db.insert("entities", {
      projectId: args.projectId,
      kind: "style",
      name: "Project style",
      lockedReferenceAssetIds: [],
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const createContinuityNote = internalMutation({
  args: {
    projectId: v.id("projects"),
    shotId: v.optional(v.id("shots")),
    takeId: v.optional(v.id("takes")),
    body: v.string(),
    authorId: v.id("users"),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    return await ctx.db.insert("notes", {
      projectId: args.projectId,
      shotId: args.shotId,
      takeId: args.takeId,
      body: args.body,
      authorId: args.authorId,
      resolved: false,
      createdAt: now,
      updatedAt: now,
    });
  },
});
