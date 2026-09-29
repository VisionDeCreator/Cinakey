import {
  createPartDocument,
  type BlockoutDocument,
} from "@cinakey/shared";
import { describe, expect, it } from "vitest";
import { api } from "./_generated/api";
import { authIdentity, createTestUser, makeTest } from "../test/helpers";

function partDocument(sequenceId: string): BlockoutDocument {
  const doc = createPartDocument(
    { id: "p", title: "t", aspectRatio: "16:9", fps: 24 },
    sequenceId,
    { name: "Part 1" },
  );
  doc.frames = 48;
  doc.camera.keys = [
    {
      id: "k0",
      f: 0,
      pos: [0, 1.6, 6],
      target: [0, 1.4, 0],
      focal: 50,
      roll: 0,
      ease: "inOut",
    },
    {
      id: "k1",
      f: 48,
      pos: [0, 1.6, 3],
      target: [0, 1.4, 0],
      focal: 50,
      roll: 0,
      ease: "inOut",
    },
  ];
  doc.objects = [
    {
      id: "m1",
      type: "character",
      name: "A",
      color: "#8cbf7a",
      size: [0.5, 1.75, 0.5],
      pos: [-1, 0],
      rot: 0,
      keys: [],
    },
    {
      id: "m2",
      type: "character",
      name: "B",
      color: "#6aa3c8",
      size: [0.5, 1.75, 0.5],
      pos: [1, 0],
      rot: 180,
      keys: [],
    },
  ];
  doc.shots = [
    {
      n: 1,
      start: 0,
      end: 48,
      desc: "MS push",
      shotType: "MS",
      lensMm: 50,
    },
  ];
  return doc;
}

describe("blockouts", () => {
  it("saves versioned part files, reloads, exports and re-imports", async () => {
    const t = makeTest();
    const userId = await createTestUser(t, "blk@test.com");
    const asUser = t.withIdentity(authIdentity(userId));
    const seeded = await asUser.mutation(api.seed.seedDemoProject, {});
    const [shotA, shotB] = seeded.shotIds;

    // Ensure a sequence exists for the part-scoped API
    const sequenceId = await t.run(async (ctx) => {
      const existing = await ctx.db
        .query("sequences")
        .withIndex("by_project", (q) => q.eq("projectId", seeded.projectId))
        .first();
      if (existing) {
        await ctx.db.patch(shotA!, {
          sequenceId: existing._id,
          updatedAt: Date.now(),
        });
        if (shotB) {
          await ctx.db.patch(shotB, {
            sequenceId: existing._id,
            updatedAt: Date.now(),
          });
        }
        return existing._id;
      }
      const now = Date.now();
      const id = await ctx.db.insert("sequences", {
        projectId: seeded.projectId,
        order: 0,
        title: "Part 1",
        durationSec: 2,
        shotIds: seeded.shotIds,
        createdAt: now,
        updatedAt: now,
      });
      for (const sid of seeded.shotIds) {
        await ctx.db.patch(sid, { sequenceId: id, updatedAt: now });
      }
      return id;
    });

    const first = await asUser.action(api.blockouts.saveForSequence, {
      sequenceId,
      document: partDocument(sequenceId),
    });
    const second = await asUser.action(api.blockouts.saveForSequence, {
      sequenceId,
      document: first.document,
    });
    expect(second.document.version).toBe(first.document.version + 1);
    expect(second.document.parentFileId).toBe(first.fileId);

    const loaded = await asUser.action(api.blockouts.getForSequence, {
      sequenceId,
    });
    expect(loaded!.document.schema).toBe("cinakey.blockout/2.0");
    expect(loaded!.document.camera.keys.map((k) => k.pos[2])).toEqual([6, 3]);
    expect(loaded!.document.objects.map((o) => o.id)).toEqual(["m1", "m2"]);

    const after = await t.run(async (ctx) => ctx.db.get(shotA!));
    expect(after!.status).toBe("blocked_out");

    const exported = await asUser.action(api.blockouts.exportDocument, {
      projectId: seeded.projectId,
      sequenceId,
    });
    expect(exported.document.camera.keys.length).toBeGreaterThan(0);

    const imported = await asUser.action(api.blockouts.importToShot, {
      shotId: shotB!,
      document: JSON.parse(JSON.stringify(exported.document)),
    });
    expect(imported.document.schema).toBe("cinakey.blockout/2.0");
    expect(imported.document.objects).toHaveLength(2);
  });
});
