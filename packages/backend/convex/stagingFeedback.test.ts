import { createPartDocument, type BlockoutDocument } from "@cinakey/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { authIdentity, createTestUser, makeTest } from "../test/helpers";

function part(sequenceId: string): BlockoutDocument {
  const doc = createPartDocument(
    { id: "p", title: "t", aspectRatio: "16:9", fps: 24 },
    sequenceId,
    {
      name: "Part 1",
    },
  );
  doc.frames = 96;
  doc.camera.keys = [
    {
      id: "k0",
      f: 0,
      pos: [0, 1.6, 6],
      target: [0, 1.4, 0],
      focal: 35,
      roll: 0,
      ease: "hold",
    },
    {
      id: "k1",
      f: 48,
      pos: [4, 1.6, 6],
      target: [4, 1.4, 0],
      focal: 35,
      roll: 0,
      ease: "hold",
    },
  ];
  doc.objects = [
    {
      id: "cast-hero",
      type: "character",
      name: "Hero",
      color: "#8cbf7a",
      size: [0.5, 1.75, 0.5],
      pos: [0, 0],
      rot: 90,
      keys: [
        { f: 0, x: 0, z: 0, rot: 90, ease: "linear" },
        { f: 96, x: 8, z: 0, rot: 90, ease: "linear" },
      ],
    },
    {
      id: "set-0",
      type: "box",
      name: "Rock",
      color: "#6b6258",
      size: [1, 1, 1],
      pos: [3, 4],
      rot: 0,
      keys: [],
    },
  ];
  doc.shots = [
    { n: 1, start: 0, end: 48, desc: "Wide" },
    { n: 2, start: 48, end: 96, desc: "Close" },
  ];
  return doc;
}

async function setup() {
  const t = makeTest();
  const userId = await createTestUser(t, "fb@test.com");
  const asUser = t.withIdentity(authIdentity(userId));
  const seeded = await asUser.mutation(api.seed.seedDemoProject, {});
  const sequenceId = await t.run(async (ctx) => {
    const now = Date.now();
    return await ctx.db.insert("sequences", {
      projectId: seeded.projectId,
      order: 0,
      title: "Part 1",
      durationSec: 4,
      shotIds: seeded.shotIds,
      createdAt: now,
      updatedAt: now,
    });
  });
  return {
    t,
    userId,
    asUser,
    projectId: seeded.projectId as Id<"projects">,
    sequenceId,
  };
}

const runArgs = (
  projectId: Id<"projects">,
  sequenceId: Id<"sequences">,
  userId: Id<"users">,
  documentFileId: Id<"_storage">,
  fresh = false,
) => ({
  projectId,
  sequenceId,
  userId,
  source: "plan" as const,
  fresh,
  documentFileId,
  issuesBefore: 3,
  issuesAfter: 1,
  issueSample: ["shot 2: Hero out of frame"],
  repaired: true,
  creditsSpent: 7,
});

describe("staging feedback", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("records runs, turns editor saves into corrections, and marks replacement / acceptance", async () => {
    vi.useFakeTimers();
    const { t, userId, asUser, projectId, sequenceId } = await setup();

    // Director save (not an edit) + run record
    const directed = await asUser.action(api.blockouts.saveForSequence, {
      sequenceId,
      document: part(sequenceId),
      origin: "director",
    });
    const runId = await t.mutation(
      internal.stagingFeedback.recordRun,
      runArgs(projectId, sequenceId, userId, directed.fileId),
    );
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect((await t.run((ctx) => ctx.db.get(runId)))!.editCount).toBe(0);

    // The user moves the camera in shot 2 and drags the hero sideways in the editor
    const edited = JSON.parse(
      JSON.stringify(directed.document),
    ) as BlockoutDocument;
    edited.camera.keys[1]!.pos = [4, 3.5, 2];
    edited.objects[0]!.keys = edited.objects[0]!.keys.map((k) => ({
      ...k,
      z: 2.5,
    }));
    await asUser.action(api.blockouts.saveForSequence, {
      sequenceId,
      document: edited,
    });
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    const run = (await t.run((ctx) => ctx.db.get(runId)))!;
    expect(run.editCount).toBe(1);
    const kinds = run.edits[0]!.corrections.map((c) => `${c.shot}:${c.kind}`);
    expect(kinds).toContain("2:camera_moved");
    expect(kinds).toContain("1:cast_moved");
    expect(kinds).not.toContain("1:camera_moved");

    // Video generation started from this part
    await t.mutation(internal.stagingFeedback.markAccepted, { sequenceId });
    expect((await t.run((ctx) => ctx.db.get(runId)))!.acceptedAt).toBeTypeOf(
      "number",
    );

    // Regenerate replaces it
    const again = await asUser.action(api.blockouts.saveForSequence, {
      sequenceId,
      document: part(sequenceId),
      origin: "director",
    });
    await t.mutation(
      internal.stagingFeedback.recordRun,
      runArgs(projectId, sequenceId, userId, again.fileId, true),
    );
    const old = (await t.run((ctx) => ctx.db.get(runId)))!;
    expect(old.supersededBy).toBe("regenerate");
    expect(old.supersededAt).toBeTypeOf("number");
  });

  it("keeps one rating per user per shot on the current run", async () => {
    const { t, userId, asUser, projectId, sequenceId } = await setup();
    await expect(
      asUser.mutation(api.stagingFeedback.rateShot, {
        sequenceId,
        shotN: 1,
        rating: "up",
      }),
    ).rejects.toThrow(/Build the blockout first/);

    const saved = await asUser.action(api.blockouts.saveForSequence, {
      sequenceId,
      document: part(sequenceId),
      origin: "director",
    });
    await t.mutation(
      internal.stagingFeedback.recordRun,
      runArgs(projectId, sequenceId, userId, saved.fileId),
    );

    await asUser.mutation(api.stagingFeedback.rateShot, {
      sequenceId,
      shotN: 1,
      rating: "up",
    });
    await asUser.mutation(api.stagingFeedback.rateShot, {
      sequenceId,
      shotN: 2,
      rating: "up",
    });
    await asUser.mutation(api.stagingFeedback.rateShot, {
      sequenceId,
      shotN: 2,
      rating: "down",
      reason: "framing",
    });
    await asUser.mutation(api.stagingFeedback.rateShot, {
      sequenceId,
      shotN: 1,
      rating: "down",
      reason: "not-a-reason",
    });
    let got = await asUser.query(api.stagingFeedback.shotRatings, {
      sequenceId,
    });
    expect(got!.ratings.sort((a, b) => a.shotN - b.shotN)).toEqual([
      { shotN: 1, rating: "down", reason: undefined },
      { shotN: 2, rating: "down", reason: "framing" },
    ]);

    await asUser.mutation(api.stagingFeedback.rateShot, {
      sequenceId,
      shotN: 1,
      rating: null,
    });
    got = await asUser.query(api.stagingFeedback.shotRatings, { sequenceId });
    expect(got!.ratings).toHaveLength(1);

    // Another user can't rate someone else's project
    const other = await createTestUser(t, "other@test.com");
    await expect(
      t
        .withIdentity(authIdentity(other))
        .mutation(api.stagingFeedback.rateShot, {
          sequenceId,
          shotN: 1,
          rating: "up",
        }),
    ).rejects.toThrow();
  });
});
