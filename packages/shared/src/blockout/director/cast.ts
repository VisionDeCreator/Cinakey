/**
 * Cast roles from script CAST / REFERENCES / group expansion.
 */

import type {
  ScriptPromptData,
  ScriptShot,
} from "../../prompt-templates/schemas";
import { inferAssetTypeFromScriptRef } from "../../prompt-templates/scriptAssets";
import {
  DEFAULT_OBJECT_DEFS,
  type BlockoutObjectType,
  type Vec3,
} from "../types";

export const CAST_COLORS = [
  "#8cbf7a",
  "#cdb48f",
  "#7a9ccb",
  "#c97a8c",
  "#c9a44f",
  "#7abfb0",
  "#e6e6e3",
  "#33363b",
];

export type CastRole = {
  id: string;
  name: string;
  type: BlockoutObjectType;
  color: string;
  size: Vec3;
  entityId?: string;
  imageN?: number;
  /** Rider sits on this cast id when both are present. */
  mountId?: string;
  /** Lateral offset from path centre (m). */
  lane: number;
  /** Along-path gap behind primary (m); negative = behind. */
  pathBias: number;
  y: number;
  travels: boolean;
  /** Pursuer pack index 0..n for schedule lanes. */
  packIndex?: number;
  /** Pair: bandit rides this raptor id. */
  rideMountId?: string;
  /**
   * What the director does with this role: the mount and its rider travel the
   * path; prey grazes then flees ahead; weapons are carried by the rider;
   * incidental cast only appears in the shots that name it.
   */
  role?: "mount" | "rider" | "prey" | "weapon" | "incidental";
  /** Prey: the individual being hunted (herd members scatter away). */
  target?: boolean;
  /** Prey herd member index (1..n); 0 / undefined for the target. */
  herdIndex?: number;
  /** Incidental: visible only in [start, end] seconds. */
  window?: [number, number];
  /** Incidental: held in the rider's hand while visible. */
  carried?: boolean;
};

const WEAPON_RE =
  /\b(rifle|gun|pistol|revolver|musket|bow|crossbow|spear|sword|knife|blade|axe|staff)\b/;
const BIRD_RE =
  /\b(bird|eagle|hawk|falcon|owl|parrot|crow|raven|vulture|pheasant|guinea\s*fowl)\b/;
const PREY_RE =
  /\b(antelope|gazelle|deer|stag|doe|impala|zebra|wildebeest|buffalo|bison|elk|moose|boar|goat|sheep|ibex|springbok|kudu|oryx|rabbit)\b/;

function classifyProxy(name: string): {
  type: BlockoutObjectType;
  size: Vec3;
  y: number;
  travels: boolean;
} {
  const n = name.toLowerCase();
  if (
    n.includes("boy") ||
    n.includes("girl") ||
    n.includes("man") ||
    n.includes("woman") ||
    n.includes("person") ||
    n.includes("rider") ||
    n.includes("bandit") ||
    n.includes("stranger")
  ) {
    return {
      type: "character",
      size: DEFAULT_OBJECT_DEFS.character.size,
      y: 0,
      travels: true,
    };
  }
  if (
    n.includes("cheetah") ||
    n.includes("hare") ||
    n.includes("rabbit") ||
    n.includes("horse") ||
    n.includes("antelope") ||
    n.includes("lion") ||
    n.includes("dog") ||
    n.includes("quad")
  ) {
    const scale =
      n.includes("cheetah") || n.includes("horse") || n.includes("giant")
        ? 1.35
        : n.includes("antelope")
          ? 0.85
          : 1;
    return {
      type: "hare",
      size: [
        DEFAULT_OBJECT_DEFS.hare.size[0] * scale,
        DEFAULT_OBJECT_DEFS.hare.size[1] * scale,
        DEFAULT_OBJECT_DEFS.hare.size[2] * scale,
      ],
      y: 0,
      travels: true,
    };
  }
  if (n.includes("raptor") || n.includes("dino")) {
    return {
      type: "raptor",
      size: DEFAULT_OBJECT_DEFS.raptor.size,
      y: 0,
      travels: true,
    };
  }
  if (
    n.includes("croc") ||
    n.includes("shark") ||
    n.includes("creature") ||
    n.includes("monster")
  ) {
    return {
      type: "raptor",
      size: [1.4, 1.2, 4.5],
      y: -0.4,
      travels: false,
    };
  }
  if (WEAPON_RE.test(n)) {
    return {
      type: "box",
      size: [0.12, 0.12, 1.1],
      y: 1.1,
      travels: true,
    };
  }
  if (BIRD_RE.test(n)) {
    return {
      type: "sphere",
      size: [0.45, 0.45, 0.45],
      y: 0,
      travels: false,
    };
  }
  if (PREY_RE.test(n)) {
    return {
      type: "hare",
      size: [
        DEFAULT_OBJECT_DEFS.hare.size[0] * 0.85,
        DEFAULT_OBJECT_DEFS.hare.size[1] * 0.85,
        DEFAULT_OBJECT_DEFS.hare.size[2] * 0.85,
      ],
      y: 0,
      travels: true,
    };
  }
  return {
    type: "creature",
    size: [0.8, 1.6, 1.2],
    y: 0,
    travels: true,
  };
}

function shotCorpus(shots: ScriptShot[]): string {
  return shots.map((s) => `${s.shotType} ${s.action}`).join(" ");
}

function countFromBlurb(...parts: Array<string | undefined>): number {
  const text = parts.filter(Boolean).join(" ").toLowerCase();
  const m =
    text.match(
      /\b(four|4|three|3|two|2|five|5|six|6)\s+(bandits?|raptors?|riders?|men|pursuers?)/,
    ) ?? text.match(/\b(bandits?|raptors?)\b[^.]*\b(four|4|three|3|two|2)\b/);
  if (!m) return 0;
  const word = (m[1] ?? m[2] ?? "").toLowerCase();
  if (word === "four" || word === "4") return 4;
  if (word === "three" || word === "3") return 3;
  if (word === "two" || word === "2") return 2;
  if (word === "five" || word === "5") return 5;
  if (word === "six" || word === "6") return 6;
  return 0;
}

function expandGroupedCast(
  roles: CastRole[],
  script: ScriptPromptData,
): CastRole[] {
  const corpus = shotCorpus(script.shots);
  const blurb = [
    ...script.castBlocks.map((c) => c.description),
    ...script.references.map((r) => `${r.entityLabel} ${r.useFor}`),
    corpus,
  ].join(" ");

  const out: CastRole[] = [];
  let packN = 0;

  for (const role of roles) {
    const isGroup =
      /^bandits?$/i.test(role.name) ||
      /bandits?\s+and\s+their\s+raptors?/i.test(role.name) ||
      (/bandit/i.test(role.name) &&
        !/\d/.test(role.name) &&
        /four|3|2|pack/i.test(blurb));

    if (!isGroup) {
      out.push(role);
      continue;
    }

    const n =
      countFromBlurb(role.name, blurb) ||
      countFromBlurb(
        script.castBlocks.find((c) => c.imageN === role.imageN)?.description,
      ) ||
      4;

    // Only expand once for the named bandit group — create bandits + matching raptors
    const alreadyHasNumbered = out.some((r) => /^Bandit\s+\d+/i.test(r.name));
    if (alreadyHasNumbered) continue;

    for (let i = 0; i < n; i++) {
      const lane =
        i % 2 === 0
          ? -1.5 - Math.floor(i / 2) * 3
          : 1.5 + Math.floor(i / 2) * 3;
      const raptorId = `cast-raptor-${i + 1}`;
      out.push({
        id: raptorId,
        name: `Raptor ${i + 1}`,
        type: "raptor",
        color: "#33363b",
        size: DEFAULT_OBJECT_DEFS.raptor.size,
        lane,
        pathBias: -(12 + i * 4),
        y: 0,
        travels: true,
        packIndex: packN + i,
      });
      out.push({
        id: `cast-bandit-${i + 1}`,
        name: `Bandit ${i + 1}`,
        type: "character",
        color: "#e6e6e3",
        size: DEFAULT_OBJECT_DEFS.character.size,
        entityId: role.entityId,
        imageN: i === 0 ? role.imageN : undefined,
        lane,
        pathBias: -(12 + i * 4),
        y: 1.3,
        travels: true,
        packIndex: packN + i,
        rideMountId: raptorId,
        mountId: raptorId,
      });
    }
    packN += n;
  }

  // Dedupe by id
  const seen = new Set<string>();
  return out.filter((r) => {
    if (seen.has(r.id)) return false;
    seen.add(r.id);
    return true;
  });
}

export function buildCast(script: ScriptPromptData): CastRole[] {
  const roles: CastRole[] = [];
  const seenImage = new Set<number>();

  const pushRole = (
    name: string,
    imageN: number,
    entityId: string | undefined,
    colorI: number,
  ) => {
    if (seenImage.has(imageN)) return;
    seenImage.add(imageN);
    const prox = classifyProxy(name);
    const type: BlockoutObjectType =
      prox.type === "creature" ? "hare" : prox.type;
    roles.push({
      id: `cast-${imageN}`,
      name: name.replace(/^the\s+/i, "").trim() || name,
      type,
      color: CAST_COLORS[colorI % CAST_COLORS.length]!,
      size: prox.size,
      entityId,
      imageN,
      lane: 0,
      pathBias: 0,
      y: prox.y,
      travels: prox.travels || type === "character" || type === "hare",
    });
  };

  script.castBlocks.forEach((c, i) => {
    pushRole(
      c.name,
      c.imageN,
      script.references.find((r) => r.imageN === c.imageN)?.entityId,
      i,
    );
  });

  script.references.forEach((ref, i) => {
    const isLocation = ref.imageN === script.location.imageN;
    const assetType = inferAssetTypeFromScriptRef({
      entityLabel: ref.entityLabel,
      useFor: ref.useFor,
      isLocation,
    });
    if (assetType === "environment") return;
    if (assetType === "product" && script.castBlocks.length > 0) {
      pushRole(ref.entityLabel, ref.imageN, ref.entityId, roles.length + i);
      return;
    }
    if (
      assetType === "character" ||
      assetType === "creature" ||
      assetType === "product"
    ) {
      pushRole(ref.entityLabel, ref.imageN, ref.entityId, roles.length + i);
    }
  });

  const expanded = expandGroupedCast(roles, script);
  roles.length = 0;
  roles.push(...expanded);

  if (roles.length === 0) {
    roles.push({
      id: "cast-figure",
      name: "Figure",
      type: "character",
      color: CAST_COLORS[0]!,
      size: DEFAULT_OBJECT_DEFS.character.size,
      lane: 0,
      pathBias: 0,
      y: 0,
      travels: true,
    });
  }

  const corpus = shotCorpus(script.shots);
  const lowerCorpus = corpus.toLowerCase();
  const descOf = (r: CastRole) =>
    [
      script.castBlocks.find((c) => c.imageN === r.imageN)?.description,
      script.references.find((x) => x.imageN === r.imageN)?.useFor,
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();

  const humans = roles.filter(
    (r) => r.type === "character" && !/^Bandit/i.test(r.name),
  );
  const animals = roles.filter(
    (r) =>
      (r.type === "hare" || r.type === "raptor") &&
      !/^Raptor\s+\d+/i.test(r.name) &&
      r.travels,
  );
  // The mount is the animal with the saddle / reins (else the first travelling animal).
  const mount =
    animals.find((r) =>
      /\bsaddle|\breins\b|\bharness|\brides?\b|\bridden\b|\bmount\b/.test(
        descOf(r),
      ),
    ) ??
    animals.find((r) => !PREY_RE.test(r.name.toLowerCase())) ??
    animals[0];
  const rider = humans[0];

  if (rider && mount) {
    rider.mountId = mount.id;
    rider.y = mount.size[1] * 0.55;
    rider.pathBias = 0.15;
    rider.role = "rider";
  }
  if (mount) {
    mount.lane = 0;
    mount.role = "mount";
  }

  const hunting =
    /\bherd|\bhunt|\bprey\b|\bflee|\btarget\b|\bstalk|\bchase|\bgrazing\b/.test(
      lowerCorpus,
    );
  let pursuerI = 0;
  let firstPrey: CastRole | undefined;
  for (const r of roles) {
    if (r === rider || r === mount) continue;
    if (
      r.mountId ||
      /^Raptor\s+\d+/i.test(r.name) ||
      /^Bandit\s+\d+/i.test(r.name)
    ) {
      continue;
    }
    if (WEAPON_RE.test(r.name.toLowerCase())) {
      r.role = "weapon";
      r.lane = 0.35;
      r.pathBias = rider?.pathBias ?? 0.2;
      r.y = (rider?.y ?? 1.2) + 0.15;
      continue;
    }
    if (
      hunting &&
      r.type === "hare" &&
      r.travels &&
      (PREY_RE.test(r.name.toLowerCase()) || !firstPrey)
    ) {
      r.role = "prey";
      if (!firstPrey) {
        firstPrey = r;
        r.target = true;
      }
      r.lane = 0;
      r.pathBias = 30;
      continue;
    }
    if (!r.travels || BIRD_RE.test(r.name.toLowerCase())) {
      r.role = "incidental";
      r.lane = 0;
      r.pathBias = 0;
      const mentions = script.shots.filter((s) => mentionsRole(s, r));
      if (mentions.length > 0) {
        r.window = [
          Math.min(...mentions.map((s) => s.startSec)),
          Math.max(...mentions.map((s) => s.endSec)),
        ];
        r.carried = mentions.some((s) =>
          /\bholds?\b|\bcarr(y|ies|ied|ying)\b|\bin\s+(his|her|their)\s+(lowered\s+)?hand\b/i.test(
            s.action,
          ),
        );
      }
      continue;
    }
    if (r.type === "raptor" || /bandit|pursu/i.test(r.name)) {
      r.lane = pursuerI % 2 === 0 ? -3.2 : 3.2;
      r.pathBias = -12 - pursuerI * 4;
      pursuerI++;
    } else {
      r.lane = (pursuerI % 2 === 0 ? -1.5 : 1.5) * (1 + pursuerI * 0.2);
      r.pathBias = -4 - pursuerI * 2;
      pursuerI++;
    }
  }

  // "herd" → the hunted animal plus four more that scatter
  if (firstPrey && /\bherd\b/.test(lowerCorpus)) {
    const proto = firstPrey;
    for (let i = 0; i < 4; i++) {
      roles.push({
        ...proto,
        id: `${proto.id}-herd${i + 1}`,
        name: `${proto.name} ${i + 2}`,
        entityId: undefined,
        imageN: undefined,
        target: false,
        herdIndex: i + 1,
        color:
          CAST_COLORS[
            (CAST_COLORS.indexOf(proto.color) + 1 + i) % CAST_COLORS.length
          ]!,
      });
    }
  }

  return roles;
}

/** Does this SHOT line name the role (by @image_N or by name)? */
export function mentionsRole(s: ScriptShot, r: CastRole): boolean {
  const text = `${s.shotType} ${s.action}`.toLowerCase();
  if (r.imageN !== undefined && new RegExp(`@image_${r.imageN}\\b`).test(text))
    return true;
  const word = r.name
    .toLowerCase()
    .replace(/[^a-z0-9 -]/g, "")
    .trim();
  return word.length > 0 && new RegExp(`\\b${word}\\b`).test(text);
}

export function primaryMount(cast: CastRole[]): CastRole | undefined {
  return (
    cast.find((r) => r.role === "mount") ??
    cast.find((r) => r.type === "hare") ??
    cast.find((c) => cast.some((h) => h.mountId === c.id))
  );
}

export function primaryRider(cast: CastRole[]): CastRole | undefined {
  return (
    cast.find((r) => r.role === "rider") ??
    cast.find(
      (r) => r.mountId && r.type === "character" && !/^Bandit/i.test(r.name),
    )
  );
}
