import type { BlockoutSheetData, ScriptPromptData } from "./schemas";
import { inferAssetTypeFromScriptRef } from "./scriptAssets";

const CAST_COLORS = [
  "#8cbf7a",
  "#cdb48f",
  "#7a9ccb",
  "#c97a8c",
  "#c9a44f",
  "#7abfb0",
];

function lensForShotType(shotType: string): number {
  const t = shotType.toLowerCase();
  if (t.includes("extreme close")) return 100;
  if (t.includes("close")) return 85;
  if (t.includes("medium")) return 50;
  if (t.includes("pov") || t.includes("scope")) return 200;
  if (t.includes("aerial") || t.includes("top") || t.includes("drone"))
    return 24;
  if (t.includes("wide") || t.includes("extreme wide")) return 24;
  return 35;
}

function moveType(cameraMove?: string): string {
  const m = (cameraMove ?? "").toLowerCase();
  if (m.includes("push")) return "push-in";
  if (m.includes("pull")) return "pull-out";
  if (m.includes("track") || m.includes("drift") || m.includes("follow"))
    return "track";
  if (m.includes("pan")) return "pan";
  if (m.includes("tilt")) return "tilt";
  if (m.includes("static") || m.includes("locked") || !m) return "static";
  return "track";
}

function setPrimitiveFromLocation(description: string): {
  primitive: string;
  size: [number, number, number];
  name: string;
} {
  const d = description.toLowerCase();
  if (d.includes("campfire") || d.includes("fire")) {
    return { primitive: "campfire", size: [0.5, 0.6, 0.5], name: "Campfire" };
  }
  if (d.includes("tree") || d.includes("forest") || d.includes("savanna")) {
    return { primitive: "tree", size: [1.2, 4, 1.2], name: "Landmark tree" };
  }
  if (d.includes("building") || d.includes("room") || d.includes("interior")) {
    return { primitive: "box", size: [6, 3, 6], name: "Set shell" };
  }
  return { primitive: "box", size: [2, 0.2, 2], name: "Location mark" };
}

function castEntryFromName(
  name: string,
  imageN: number,
  entityId: string | undefined,
  colorI: number,
): BlockoutSheetData["cast"][number] {
  const n = name.toLowerCase();
  const isHuman =
    n.includes("boy") ||
    n.includes("girl") ||
    n.includes("man") ||
    n.includes("woman") ||
    n.includes("person") ||
    n.includes("rider");
  const isQuad =
    n.includes("cheetah") ||
    n.includes("horse") ||
    n.includes("antelope") ||
    n.includes("lion") ||
    n.includes("dog");
  return {
    id: `cast-${imageN}`,
    name: name.replace(/^the\s+/i, "").trim() || name,
    proxy: (isHuman
      ? "humanoid mannequin"
      : isQuad
        ? "quadruped"
        : "creature proxy") as
      | "humanoid mannequin"
      | "quadruped"
      | "creature proxy",
    imageN,
    entityId,
    heightM: isHuman ? 1.7 : isQuad ? 1.2 : 2,
    lengthM: isQuad ? 2.5 : undefined,
    colorCode: CAST_COLORS[colorI % CAST_COLORS.length],
  };
}

/**
 * Deterministic Phase 7C blockout sheet from a script prompt.
 * Used by Update blockout — hand-tuned shots are preserved via scriptLineKey.
 */
export function buildBlockoutSheetFromScript(
  script: ScriptPromptData,
  opts: {
    sequenceTitle: string;
    scriptPromptVersion: number;
    aspectRatio: string;
    fps: number;
  },
): BlockoutSheetData {
  const cast: BlockoutSheetData["cast"] = [];
  const seen = new Set<number>();

  for (const [i, c] of script.castBlocks.entries()) {
    seen.add(c.imageN);
    cast.push(
      castEntryFromName(
        c.name,
        c.imageN,
        script.references.find((r) => r.imageN === c.imageN)?.entityId,
        i,
      ),
    );
  }

  for (const [i, ref] of script.references.entries()) {
    if (seen.has(ref.imageN)) continue;
    const isLocation = ref.imageN === script.location.imageN;
    const assetType = inferAssetTypeFromScriptRef({
      entityLabel: ref.entityLabel,
      useFor: ref.useFor,
      isLocation,
    });
    if (assetType === "environment") continue;
    if (
      assetType === "character" ||
      assetType === "creature" ||
      assetType === "product"
    ) {
      seen.add(ref.imageN);
      cast.push(
        castEntryFromName(
          ref.entityLabel,
          ref.imageN,
          ref.entityId,
          cast.length + i,
        ),
      );
    }
  }

  const loc = setPrimitiveFromLocation(script.location.description);
  const set = [
    {
      id: `set-loc-${script.location.imageN}`,
      name: loc.name,
      primitive: loc.primitive,
      position: [0, 0, 0] as [number, number, number],
      size: loc.size,
      notes: script.location.description.slice(0, 160),
    },
  ];

  const shots = script.shots.map((s, i) => {
    const z = i * 2;
    const camZ = z + 4;
    return {
      n: s.n,
      startSec: s.startSec,
      endSec: s.endSec,
      shotType: s.shotType,
      lensMm: lensForShotType(s.shotType),
      cameraMove: s.cameraMove?.trim() || "static",
      camera: {
        startPosition: [0, 1.6, camZ] as [number, number, number],
        startLookAt: [0, 1.2, z] as [number, number, number],
        endPosition: [0, 1.6, camZ - 0.5] as [number, number, number],
        endLookAt: [0, 1.2, z] as [number, number, number],
        moveType: moveType(s.cameraMove),
      },
      blocking: cast.slice(0, 2).map((c, ci) => ({
        targetId: c.id,
        startPosition: [ci * 1.5 - 0.75, 0, z] as [number, number, number],
        startPose: "standing" as const,
        endPosition: [ci * 1.5 - 0.75, 0, z + 0.5] as [
          number,
          number,
          number,
        ],
        endPose: "standing" as const,
      })),
      events: [],
      frameMustShow: s.action.slice(0, 160),
      continuity: "Match script prompt continuity.",
      transitionOut: "cut",
    };
  });

  return {
    sequenceTitle: opts.sequenceTitle,
    scriptPromptVersion: opts.scriptPromptVersion,
    durationSec: script.totalDurationSec,
    aspectRatio: opts.aspectRatio,
    fps: opts.fps,
    shotCount: shots.length,
    worldOriginLandmark: "origin at set centre",
    references: script.references.map((r) => ({
      imageN: r.imageN,
      entityLabel: r.entityLabel,
      standInId: `stand-${r.imageN}`,
    })),
    set,
    cast,
    props: [],
    light: {
      sunAzimuthDeg: 220,
      sunElevationDeg: 15,
      colorTemperatureK: 4500,
      notes: "Match script LIGHTING.",
    },
    shots,
  };
}
