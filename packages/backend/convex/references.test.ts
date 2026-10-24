import { describe, expect, it } from "vitest";
import { api } from "../../../apps/api/src/operations";
import { authIdentity, createTestUser, makeTest } from "../test/helpers";
async function fixture() {
  const t = makeTest();
  const userId = await createTestUser(t, "references@test.com");
  const owner = t.withIdentity(authIdentity(userId));
  await owner.mutation(api.users.ensurePersonalWorkspace, {});
  const projectId = await owner.mutation(api.projects.create, {
    title: "Film",
  });
  async function asset(name: string, type: "image" | "video" = "image") {
    const storageId = await t.run((ctx) =>
      ctx.storage.store(
        new Blob([name], {
          type: type === "image" ? "image/png" : "video/mp4",
        }),
      ),
    );
    return owner.mutation(api.storage.createAssetFromUpload, {
      projectId,
      name,
      type,
      storageId,
    });
  }
  return { t, owner, projectId, asset };
}
describe("project reference bindings and footage visibility", () => {
  it("atomically replaces one alias, preserves it through asset renames, and protects its media", async () => {
    const { owner, projectId, asset } = await fixture();
    const first = await asset("James"),
      second = await asset("James closeup");
    await owner.mutation(api.references.bind, {
      projectId,
      alias: "@IMAGE_1",
      assetId: first,
    });
    await owner.mutation(api.references.bind, {
      projectId,
      alias: "image_1",
      assetId: second,
    });
    await owner.mutation(api.assets.update, { assetId: second, name: "John" });
    expect(await owner.query(api.references.list, { projectId })).toEqual([
      { alias: "image_1", assetId: second },
    ]);
    await expect(
      owner.mutation(api.assets.remove, { assetId: second }),
    ).rejects.toThrow("reference assignments");
  });
  it("rejects foreign media, mismatched reference types, and access by another user", async () => {
    const { t, owner, projectId, asset } = await fixture();
    const image = await asset("James");
    await expect(
      owner.mutation(api.references.bind, {
        projectId,
        alias: "video_1",
        assetId: image,
      }),
    ).rejects.toThrow("media type");
    const otherUserId = await createTestUser(t, "other-references@test.com");
    const other = t.withIdentity(authIdentity(otherUserId));
    await other.mutation(api.users.ensurePersonalWorkspace, {});
    const otherProject = await other.mutation(api.projects.create, {
      title: "Other",
    });
    await expect(
      owner.mutation(api.references.bind, {
        projectId: otherProject,
        alias: "james",
        assetId: image,
      }),
    ).rejects.toThrow("access denied");
    await expect(
      other.mutation(api.references.bind, {
        projectId: otherProject,
        alias: "james",
        assetId: image,
      }),
    ).rejects.toThrow("not found");
    await expect(
      other.query(api.shotGeneration.listProjectVideos, { projectId }),
    ).rejects.toThrow("access denied");
  });
  it("lists existing video assets even when no script, sequence-master tag, or generation job exists", async () => {
    const { owner, projectId, asset } = await fixture();
    const video = await asset("Unlinked video", "video");
    const result = await owner.query(api.shotGeneration.listProjectVideos, {
      projectId,
    });
    expect(result.videos).toHaveLength(1);
    expect(result.videos[0]).toMatchObject({
      assetId: video,
      name: "Unlinked video",
      sequenceId: null,
      generated: false,
    });
    expect(result.videos[0]!.url).toBeTruthy();
  });
});

describe("reference inputs across script saves and generation", () => {
  it("freezes named references, accepts a video reference, and recompiles every occurrence after replacement", async () => {
    const { owner, projectId, asset } = await fixture();
    const james = await asset("James"),
      replacement = await asset("James second"),
      camera = await asset("Camera move", "video");
    const script =
      "SHOTS (5 seconds total, multi-shot, 16:9):\nShot 1 (0.0s–5.0s) — @james walks past @image_1, then @james turns. Follow @video_1.\n\nTECHNICAL:\n16:9, 24fps.";
    await owner.mutation(api.references.bind, {
      projectId,
      alias: "image_1",
      assetId: james,
    });
    await owner.mutation(api.references.bind, {
      projectId,
      alias: "video_1",
      assetId: camera,
    });
    const saved = await owner.action(api.promptSheets.saveScriptPromptText, {
      projectId,
      promptText: script,
      newPart: true,
    });
    await owner.mutation(api.assets.update, {
      assetId: james,
      name: "Renamed character",
    });
    const first = await owner.action(api.shotGeneration.assemblePromptAction, {
      sequenceId: saved.sequenceId,
    });
    expect(first.referenceAssetIds).toEqual([james]);
    expect(first.referenceVideoAssetId).toBe(camera);
    expect(first.prompt.match(/@image_1/g)).toHaveLength(3);
    expect(first.prompt).not.toContain("@james");
    const shots = await owner.query(api.shots.listByProject, { projectId });
    const single = await owner.action(api.shotGeneration.assemblePromptAction, {
      sequenceId: saved.sequenceId,
      shotId: shots[0]!._id,
    });
    expect(single.referenceAssetIds).toEqual([james]);
    expect(single.referenceVideoAssetId).toBe(camera);

    await owner.mutation(api.references.bind, {
      projectId,
      alias: "image_1",
      assetId: replacement,
    });
    const second = await owner.action(api.shotGeneration.assemblePromptAction, {
      sequenceId: saved.sequenceId,
    });
    expect(second.referenceAssetIds).toEqual([james, replacement]);
    expect(second.prompt).toContain(
      "@image_1 walks past @image_2, then @image_1",
    );
    // A new scene must not overwrite the first scene, including when both were created from freeform scripts.
    const another = await owner.action(api.promptSheets.saveScriptPromptText, {
      projectId,
      promptText: script,
      newPart: true,
      title: "Scene 2",
    });
    expect(another.sequenceId).not.toBe(saved.sequenceId);
    expect(
      await owner.query(api.promptSheets.listScriptParts, { projectId }),
    ).toHaveLength(2);
  });
  it("blocks unresolved aliases before reserving credits", async () => {
    const { t, owner, projectId } = await fixture();
    const saved = await owner.action(api.promptSheets.saveScriptPromptText, {
      projectId,
      newPart: true,
      promptText:
        "SHOTS (5 seconds total, multi-shot, 16:9):\nShot 1 (0.0s–5.0s) — @missing walks into frame.\n\nTECHNICAL:\n16:9, 24fps.",
    });
    const before = await owner.query(api.credits.getBalance, {});
    await expect(
      owner.action(api.shotGeneration.startSequenceGeneration, {
        sequenceId: saved.sequenceId,
      }),
    ).rejects.toThrow("Link these references");
    expect(await owner.query(api.credits.getBalance, {})).toEqual(before);
    expect(
      await t.run((ctx) => ctx.db.query("generationJobs").collect()),
    ).toHaveLength(0);
  });
});
