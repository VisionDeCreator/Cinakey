import { afterEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "./_generated/api";
import { authIdentity, createTestUser, makeTest } from "../test/helpers";

const SCRIPT = `REFERENCES
@image_1 = the hero. Use it for his face.
ART STYLE — LOCKED TO THE REFERENCE IMAGES:
Painted.
IMAGE QUALITY — ALWAYS SHARP AND CLEAN:
Sharp.
THE HERO — @image_1, identical in every shot:
A tall man.
LOCATION — @image_1: an empty street.
SHOTS (4 seconds total, multi-shot, 16:9):
Shot 1 (0.0s–2.0s) — Wide shot: the hero walks down the street.
Shot 2 (2.0s–4.0s) — Close-up on the hero's face: he stops.
CONSISTENCY:
Same.
MOTION AND PHYSICS:
Real.
LIGHTING:
Day.
TECHNICAL:
16:9, 24fps.
MUSIC:
None.
AUDIO (native sound, synced to picture):
0.0s steps.
`;

/** A plan whose hero is hidden during shot 2 — the automatic check flags it. */
const plan = (heroVisible?: Array<[number, number]>) => ({
  schema: "cinakey.staging/1.0",
  set: { terrain: "urban", timeOfDay: "day", features: [] },
  cast: [
    {
      id: "hero",
      name: "the hero",
      kind: "person",
      imageN: 1,
      at: [0, 0],
      facing: 90,
      ...(heroVisible ? { visible: heroVisible } : {}),
    },
  ],
  shots: [
    {
      n: 1,
      moves: [{ who: "hero", action: "walk", path: [[3, 0]] }],
      camera: {
        size: "wide",
        angle: "eye",
        side: "front_left",
        move: "static",
        subject: "hero",
      },
    },
    {
      n: 2,
      moves: [{ who: "hero", action: "stand" }],
      camera: {
        size: "cu",
        angle: "eye",
        side: "front",
        move: "static",
        subject: "hero",
      },
    },
  ],
});

function stubDeepSeek(replies: unknown[]) {
  const bodies: Array<{ messages: Array<{ role: string; content: string }> }> =
    [];
  let i = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init: { body: string }) => {
      bodies.push(JSON.parse(init.body));
      const reply = replies[Math.min(i++, replies.length - 1)];
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: JSON.stringify(reply) } }],
          usage: { total_tokens: 2000 },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }),
  );
  return bodies;
}

async function setup() {
  vi.stubEnv("DEEPSEEK_API_KEY", "test-key");
  vi.stubEnv("USE_MOCK_ADAPTERS", "false");
  const t = makeTest();
  const userId = await createTestUser(t, "stage@test.com", { isStaff: true });
  const asUser = t.withIdentity(authIdentity(userId));
  const seeded = await asUser.mutation(api.seed.seedDemoProject, {});
  await asUser.mutation(api.credits.grantDev, { amount: 500 });
  const { sequenceId, scriptPromptId } = await t.run(async (ctx) => {
    const now = Date.now();
    const sequenceId = await ctx.db.insert("sequences", {
      projectId: seeded.projectId,
      order: 0,
      title: "Part 1",
      durationSec: 4,
      shotIds: [],
      createdAt: now,
      updatedAt: now,
    });
    const scriptPromptId = await ctx.db.insert("promptSheets", {
      projectId: seeded.projectId,
      type: "script",
      sequenceId,
      structuredFileId: await ctx.storage.store(new Blob(["{}"])),
      renderedText: SCRIPT,
      templateVersion: "1",
      status: "approved",
      isCustom: false,
      version: 1,
      isTip: true,
      createdAt: now,
      updatedAt: now,
    } as never);
    return { sequenceId, scriptPromptId };
  });
  const run = () =>
    t.action(internal.staging.generatePlan, {
      projectId: seeded.projectId,
      sequenceId,
      userId,
      scriptPromptId,
      scriptText: SCRIPT,
      shotCount: 2,
      durationSec: 4,
      aspectRatio: "16:9",
    });
  return { run };
}

describe("staging repair pass", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("sends the check's findings back once and keeps the fixed plan", async () => {
    const { run } = await setup();
    const bodies = stubDeepSeek([plan([[0, 2]]), plan()]);
    const result = await run();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(bodies).toHaveLength(2);
    const repairAsk = bodies[1]!.messages[bodies[1]!.messages.length - 1]!.content;
    expect(repairAsk).toMatch(/Shot 2: the hero hidden while framed/);
    expect(repairAsk).toMatch(/visible/);
    expect(result.repaired).toBe(true);
    expect(result.issuesBefore).toBe(1);
    expect(result.issuesAfter).toBe(0);
    expect(result.plan.cast[0]!.visible).toBeUndefined();
  });

  it("keeps the first plan when the repair is no better, and skips repair when clean", async () => {
    const { run } = await setup();
    stubDeepSeek([plan([[0, 2]]), plan([[0, 1]])]);
    const worse = await run();
    expect(worse.ok && worse.repaired).toBe(false);
    expect(worse.ok && worse.plan.cast[0]!.visible).toEqual([[0, 2]]);

    const bodies = stubDeepSeek([plan()]);
    const clean = await run();
    expect(clean.ok && clean.issuesBefore).toBe(0);
    expect(bodies).toHaveLength(1);
  });
});
