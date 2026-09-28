import type { BlockoutSheetData, ScriptPromptData } from "./schemas";

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
  const cast = script.castBlocks.map((c, i) => {
    const name = c.name.toLowerCase();
    const isHuman =
      name.includes("boy") ||
      name.includes("girl") ||
      name.includes("man") ||
      name.includes("woman") ||
      name.includes("person") ||
      name.includes("rider");
    const isQuad =
      name.includes("cheetah") ||
      name.includes("horse") ||
      name.includes("antelope") ||
      name.includes("lion") ||
      name.includes("dog");
    return {
      id: `cast-${c.imageN}`,
      name: c.name,
      proxy: (isHuman
        ? "humanoid mannequin"
        : isQuad
          ? "quadruped"
          : "creature proxy") as "humanoid mannequin" | "quadruped" | "creature proxy",
      imageN: c.imageN,
      entityId: script.references.find((r) => r.imageN === c.imageN)?.entityId,
      heightM: isHuman ? 1.7 : isQuad ? 1.2 : 2,
      lengthM: isQuad ? 2.5 : undefined,
      colorCode: `C${i + 1}`,
    };
  });

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
    set: [],
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
