import { describe, expect, it } from "vitest";
import { api } from "./_generated/api";
import {
  assertJsonWithinLimits,
  jsonByteLength,
  MAX_JSON_BYTES,
  mustStoreAsFile,
} from "./storage";
import {
  authIdentity,
  createTestUser,
  makeTest,
} from "../test/helpers";

describe("storage helpers", () => {
  it("always stores JSON as files and enforces size cap", () => {
    expect(mustStoreAsFile(1)).toBe(true);
    expect(jsonByteLength({ a: 1 })).toBeGreaterThan(0);
    expect(() => assertJsonWithinLimits(MAX_JSON_BYTES + 1)).toThrow(
      /too large/,
    );
    expect(() => assertJsonWithinLimits(100)).not.toThrow();
  });

  it("creates an asset with size and type from an uploaded file", async () => {
    const t = makeTest();
    const userId = await createTestUser(t, "up@test.com");
    const asUser = t.withIdentity(authIdentity(userId));
    const projectId = await asUser.mutation(api.projects.create, {
      title: "Assets",
    });

    const storageId = await t.run(async (ctx) => {
      return await ctx.storage.store(
        new Blob(["hello-image"], { type: "image/png" }),
      );
    });

    const assetId = await asUser.mutation(api.storage.createAssetFromUpload, {
      projectId,
      storageId,
      type: "image",
      format: "image/png",
    });

    const asset = await asUser.query(api.storage.getAsset, { assetId });
    expect(asset).not.toBeNull();
    expect(asset!.type).toBe("image");
    expect(asset!.format).toBe("image/png");
    expect(asset!.sizeBytes).toBeGreaterThan(0);

    const url = await asUser.query(api.storage.getAssetUrl, { assetId });
    expect(url).toBeTruthy();
  });

  it("denies another user from reading an asset URL", async () => {
    const t = makeTest();
    const ownerId = await createTestUser(t, "a@test.com");
    const otherId = await createTestUser(t, "b@test.com");
    const asOwner = t.withIdentity(authIdentity(ownerId));
    const asOther = t.withIdentity(authIdentity(otherId));

    const projectId = await asOwner.mutation(api.projects.create, {
      title: "Private assets",
    });
    const storageId = await t.run(async (ctx) => {
      return await ctx.storage.store(new Blob(["x"], { type: "image/png" }));
    });
    const assetId = await asOwner.mutation(api.storage.createAssetFromUpload, {
      projectId,
      storageId,
      type: "image",
    });

    await expect(
      asOther.query(api.storage.getAssetUrl, { assetId }),
    ).rejects.toThrow(/Project access denied/);
  });

  it("deletes asset with ownership check", async () => {
    const t = makeTest();
    const ownerId = await createTestUser(t, "del@test.com");
    const otherId = await createTestUser(t, "nosy@test.com");
    const asOwner = t.withIdentity(authIdentity(ownerId));
    const asOther = t.withIdentity(authIdentity(otherId));

    const projectId = await asOwner.mutation(api.projects.create, {
      title: "Del",
    });
    const storageId = await t.run(async (ctx) => {
      return await ctx.storage.store(new Blob(["y"], { type: "image/png" }));
    });
    const assetId = await asOwner.mutation(api.storage.createAssetFromUpload, {
      projectId,
      storageId,
      type: "image",
    });

    await expect(
      asOther.mutation(api.storage.deleteAsset, { assetId }),
    ).rejects.toThrow(/Project access denied/);

    await asOwner.mutation(api.storage.deleteAsset, { assetId });
    const gone = await asOwner.query(api.storage.getAsset, { assetId });
    expect(gone).toBeNull();
  });
});
