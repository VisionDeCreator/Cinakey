/**
 * Materialize a cinakey.script/1.0 document into live scenes + entities,
 * and flag shots outdated when linked dialogue lines change.
 */

import {
  extractCharacterNames,
  extractLocationNames,
  normalizeEntityName,
  withRuntimeEstimates,
  type ScriptDocument,
  type ScriptEntityKind,
} from "@cinakey/shared";
import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";

export async function materializeScript(
  ctx: MutationCtx,
  args: {
    projectId: Id<"projects">;
    document: ScriptDocument;
  },
): Promise<{
  document: ScriptDocument;
  sceneIds: Id<"scenes">[];
  entityIds: Id<"entities">[];
}> {
  const document = withRuntimeEstimates(args.document);
  const now = Date.now();

  const existingScenes = await ctx.db
    .query("scenes")
    .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
    .collect();
  const scenesByElement = new Map(
    existingScenes.map((s) => [s.elementId, s]),
  );

  // Snapshot prior dialogue line ids per scene (by elementId) for outdated checks.
  const priorLineIds = new Map<string, Set<string>>();
  // We don't store line ids on scenes; compare using previous tip isn't available
  // here. Callers that need outdated detection should pass previousDocument.
  // This function accepts optional previous via closure — see materializeScriptWithPrevious.

  const sceneIds: Id<"scenes">[] = [];
  const seenElementIds = new Set<string>();

  for (let order = 0; order < document.scenes.length; order++) {
    const scene = document.scenes[order]!;
    seenElementIds.add(scene.id);
    const existing = scenesByElement.get(scene.id);
    if (existing) {
      await ctx.db.patch(existing._id, {
        order,
        heading: scene.heading,
        synopsis: scene.synopsis,
        updatedAt: now,
      });
      sceneIds.push(existing._id);
    } else {
      const id = await ctx.db.insert("scenes", {
        projectId: args.projectId,
        elementId: scene.id,
        order,
        heading: scene.heading,
        synopsis: scene.synopsis,
        createdAt: now,
        updatedAt: now,
      });
      sceneIds.push(id);
    }
  }

  // Soft-clear scenes removed from the script (keep row if shots still reference).
  for (const existing of existingScenes) {
    if (seenElementIds.has(existing.elementId)) continue;
    const shots = await ctx.db
      .query("shots")
      .withIndex("by_scene", (q) => q.eq("sceneId", existing._id))
      .first();
    if (shots === null) {
      await ctx.db.delete(existing._id);
    } else {
      await ctx.db.patch(existing._id, {
        synopsis: existing.synopsis
          ? `${existing.synopsis} (removed from script)`
          : "Removed from script",
        updatedAt: now,
      });
    }
  }

  const entityIds = await upsertEntitiesFromScript(ctx, {
    projectId: args.projectId,
    document,
    now,
  });

  // Rewrite entityLinks + characterId on lines where we matched names.
  const linked = await linkCharacterIds(ctx, {
    projectId: args.projectId,
    document,
  });

  void priorLineIds;
  return { document: linked, sceneIds, entityIds };
}

export async function materializeScriptWithPrevious(
  ctx: MutationCtx,
  args: {
    projectId: Id<"projects">;
    document: ScriptDocument;
    previousDocument?: ScriptDocument | null;
  },
): Promise<{
  document: ScriptDocument;
  sceneIds: Id<"scenes">[];
  entityIds: Id<"entities">[];
}> {
  const result = await materializeScript(ctx, {
    projectId: args.projectId,
    document: args.document,
  });

  if (args.previousDocument) {
    await flagOutdatedShots(ctx, {
      projectId: args.projectId,
      previous: args.previousDocument,
      next: result.document,
    });
  }

  return result;
}

async function upsertEntitiesFromScript(
  ctx: MutationCtx,
  args: {
    projectId: Id<"projects">;
    document: ScriptDocument;
    now: number;
  },
): Promise<Id<"entities">[]> {
  const existing = await ctx.db
    .query("entities")
    .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
    .collect();

  const byKindName = new Map<string, (typeof existing)[number]>();
  for (const e of existing) {
    byKindName.set(`${e.kind}:${normalizeEntityName(e.name)}`, e);
  }

  const ids: Id<"entities">[] = [];

  const upsert = async (
    kind: ScriptEntityKind,
    name: string,
    description?: string,
  ) => {
    const key = `${kind}:${normalizeEntityName(name)}`;
    const found = byKindName.get(key);
    if (found) {
      if (found.name !== name.trim() || (description && !found.description)) {
        await ctx.db.patch(found._id, {
          name: name.trim(),
          description: description ?? found.description,
          updatedAt: args.now,
        });
      }
      ids.push(found._id);
      return found._id;
    }
    const id = await ctx.db.insert("entities", {
      projectId: args.projectId,
      kind,
      name: name.trim(),
      description,
      lockedReferenceAssetIds: [],
      createdAt: args.now,
      updatedAt: args.now,
    });
    byKindName.set(key, {
      _id: id,
      _creationTime: args.now,
      projectId: args.projectId,
      kind,
      name: name.trim(),
      description,
      lockedReferenceAssetIds: [],
      createdAt: args.now,
      updatedAt: args.now,
    });
    ids.push(id);
    return id;
  };

  for (const name of extractCharacterNames(args.document)) {
    await upsert("character", name);
  }
  for (const name of extractLocationNames(args.document)) {
    await upsert("location", name);
  }

  return ids;
}

async function linkCharacterIds(
  ctx: MutationCtx,
  args: {
    projectId: Id<"projects">;
    document: ScriptDocument;
  },
): Promise<ScriptDocument> {
  const entities = await ctx.db
    .query("entities")
    .withIndex("by_project_kind", (q) =>
      q.eq("projectId", args.projectId).eq("kind", "character"),
    )
    .collect();
  const byName = new Map(
    entities.map((e) => [normalizeEntityName(e.name), e]),
  );

  const locations = await ctx.db
    .query("entities")
    .withIndex("by_project_kind", (q) =>
      q.eq("projectId", args.projectId).eq("kind", "location"),
    )
    .collect();
  const locByName = new Map(
    locations.map((e) => [normalizeEntityName(e.name), e]),
  );

  const entityLinks: ScriptDocument["entityLinks"] = [];
  const linkMap = new Map<
    string,
    { entityId: string; kind: ScriptEntityKind; nameAtLink: string; elementIds: Set<string> }
  >();

  const addLink = (
    entityId: string,
    kind: ScriptEntityKind,
    nameAtLink: string,
    elementId: string,
  ) => {
    const existing = linkMap.get(entityId);
    if (existing) {
      existing.elementIds.add(elementId);
      return;
    }
    linkMap.set(entityId, {
      entityId,
      kind,
      nameAtLink,
      elementIds: new Set([elementId]),
    });
  };

  const scenes = args.document.scenes.map((scene) => {
    const locName = extractLocationFromHeading(scene.heading);
    if (locName) {
      const loc = locByName.get(normalizeEntityName(locName));
      if (loc) addLink(loc._id, "location", loc.name, scene.id);
    }

    return {
      ...scene,
      beats: scene.beats.map((beat) => ({
        ...beat,
        lines: beat.lines.map((line) => {
          const ent = byName.get(normalizeEntityName(line.characterName));
          if (ent) {
            addLink(ent._id, "character", ent.name, line.id);
            return { ...line, characterId: ent._id };
          }
          return line;
        }),
      })),
    };
  });

  for (const link of linkMap.values()) {
    entityLinks.push({
      entityId: link.entityId,
      kind: link.kind,
      nameAtLink: link.nameAtLink,
      elementIds: [...link.elementIds],
    });
  }

  return {
    ...args.document,
    scenes,
    entityLinks,
  };
}

function extractLocationFromHeading(heading: string): string | null {
  const match = heading
    .trim()
    .match(
      /^(?:INT\.?|EXT\.?|I\/E\.?|INT\/EXT\.?)\s+(.+?)(?:\s+[-–—]\s+.+)?$/i,
    );
  return match?.[1]?.trim() ?? null;
}

async function flagOutdatedShots(
  ctx: MutationCtx,
  args: {
    projectId: Id<"projects">;
    previous: ScriptDocument;
    next: ScriptDocument;
  },
): Promise<void> {
  const prevLines = new Map<string, { sceneId: string; dialogue: string }>();
  for (const scene of args.previous.scenes) {
    for (const beat of scene.beats) {
      for (const line of beat.lines) {
        prevLines.set(line.id, {
          sceneId: scene.id,
          dialogue: line.dialogue,
        });
      }
    }
  }

  const nextLines = new Map<string, { sceneId: string; dialogue: string }>();
  for (const scene of args.next.scenes) {
    for (const beat of scene.beats) {
      for (const line of beat.lines) {
        nextLines.set(line.id, {
          sceneId: scene.id,
          dialogue: line.dialogue,
        });
      }
    }
  }

  /** Line ids whose text changed or that were removed. */
  const changedOrRemoved = new Set<string>();
  for (const [id, prev] of prevLines) {
    const next = nextLines.get(id);
    if (!next || next.dialogue !== prev.dialogue) {
      changedOrRemoved.add(id);
    }
  }

  if (changedOrRemoved.size === 0) return;

  const scenes = await ctx.db
    .query("scenes")
    .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
    .collect();
  const now = Date.now();

  for (const scene of scenes) {
    const shots = await ctx.db
      .query("shots")
      .withIndex("by_scene", (q) => q.eq("sceneId", scene._id))
      .collect();
    for (const shot of shots) {
      if (!shot.dialogueLineId) continue;
      if (!changedOrRemoved.has(shot.dialogueLineId)) continue;

      const nextLine = nextLines.get(shot.dialogueLineId);
      const patch: {
        outdated: boolean;
        updatedAt: number;
        dialogue?: string;
      } = {
        outdated: true,
        updatedAt: now,
      };
      if (nextLine) {
        patch.dialogue = nextLine.dialogue;
      }
      await ctx.db.patch(shot._id, patch);
    }
  }
}
