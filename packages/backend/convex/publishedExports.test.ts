import type { Id } from "./_generated/dataModel";
import { describe, expect, it, vi } from "vitest";
import { createEmptyTimeline } from "@cinakey/shared";
import { api, internal } from "../../../apps/api/src/operations";
import { uploadPublication } from "../../../apps/api/src/services/publishedExports";
import {
  exchangeShare,
  hashSecret,
  serveSharedMedia,
} from "../../../apps/api/src/services/exportSharing";
import { readExportMetadata } from "../../../apps/api/src/services/exportMetadata";
import { SAMPLE_MP4_BASE64 } from "../../../apps/api/test/mockVideo";
import { makeTest, createTestUser, authIdentity } from "../test/helpers";

async function fixture() {
  const t = makeTest();
  const userId = await createTestUser(t, "publisher@test.com");
  const owner = t.withIdentity(authIdentity(userId));
  const projectId = await owner.mutation(api.projects.create, {
    title: "Film",
  });
  const project = (await owner.query(api.projects.get, { projectId }))!;
  const bytes = Uint8Array.from(atob(SAMPLE_MP4_BASE64), (c) =>
    c.charCodeAt(0),
  );
  const blob = new Blob([bytes], { type: "video/mp4" });
  const metadata = await readExportMetadata(blob);
  const doc = createEmptyTimeline({
    id: projectId,
    aspectRatio: "16:9",
    fps: 24,
  });
  doc.durationSec = metadata.durationSec;
  const lock = await owner.mutation(api.timelineLeases.claim, {
    projectId,
    sessionId: "publish",
  });
  if (!lock.held) throw new Error("Expected edit lease");
  const { versionId } = await owner.action(api.timelineVersions.save, {
    projectId,
    document: doc,
    parentId: null,
    requestId: "saved",
    sessionId: "publish",
    fence: lock.fence,
  });
  const beginArgs = {
    projectId,
    versionId,
    requestId: "publication",
    title: "Film",
    ...metadata,
  };
  const publicationId = await owner.mutation(
    internal.publishedExports.beginValidated,
    beginArgs,
  );
  const ctx = {
    runQuery: owner.query,
    runMutation: owner.mutation,
    storage: {
      store: (data: Blob) => t.run((ctx) => ctx.storage.store(data)),
      delete: (id: Id<"_storage">) => t.run((ctx) => ctx.storage.delete(id)),
      getUrl: () => Promise.resolve("https://storage.example/video"),
    },
  };
  const upload = () =>
    uploadPublication(
      ctx as never,
      publicationId,
      new Request("http://localhost/upload", {
        method: "POST",
        headers: { "Content-Type": "video/mp4" },
        body: bytes,
      }),
    );
  return {
    t,
    owner,
    userId,
    projectId,
    project,
    versionId,
    publicationId,
    ctx,
    upload,
    bytes,
    blob,
    metadata,
    beginArgs,
  };
}

describe("stored exports and sharing", () => {
  it("publishes immutable validated bytes and safely retries upload acknowledgement", async () => {
    const f = await fixture();
    expect(
      await f.owner.mutation(
        internal.publishedExports.beginValidated,
        f.beginArgs,
      ),
    ).toBe(f.publicationId);
    await f.upload();
    await f.upload();
    const rows = await f.owner.query(api.publishedExports.list, {
      projectId: f.projectId,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      state: "ready",
      versionId: f.versionId,
      sizeBytes: f.blob.size,
    });
    expect(rows[0]).not.toHaveProperty("storageId");
    const row = (await f.t.run((ctx) => ctx.db.get(f.publicationId)))!;
    expect(row.sha256).toMatch(/^[a-f0-9]{64}$/);
    await f.owner.mutation(internal.storageIO.remove, { id: row.storageId! });
    expect(
      await f.t.run(
        async (ctx) =>
          (await ctx.storage.get(row.storageId! as Id<"_storage">)) !== null,
      ),
    ).toBe(true);
    await expect(
      f.owner.mutation(internal.publishedExports.claimUpload, {
        publicationId: f.publicationId,
        attempt: "late",
      }),
    ).resolves.toMatchObject({ state: "ready" });
  });

  it("reserves export capacity atomically and fences an abandoned upload attempt", async () => {
    const f = await fixture();
    await f.owner.mutation(internal.publishedExports.claimUpload, {
      publicationId: f.publicationId,
      attempt: "old",
    });
    await expect(
      f.owner.mutation(internal.publishedExports.claimUpload, {
        publicationId: f.publicationId,
        attempt: "concurrent",
      }),
    ).rejects.toThrow("in progress");
    const file = await f.t.run((ctx) => ctx.storage.store(f.blob));
    await f.owner.mutation(internal.publishedExports.stageUpload, {
      publicationId: f.publicationId,
      attempt: "old",
      storageId: file,
    });
    await f.t.run((ctx) =>
      ctx.db.patch(f.publicationId, { leaseUntil: Date.now() - 1 }),
    );
    await f.owner.mutation(internal.publishedExports.claimUpload, {
      publicationId: f.publicationId,
      attempt: "new",
    });
    await expect(
      f.owner.mutation(internal.publishedExports.finalize, {
        publicationId: f.publicationId,
        attempt: "old",
        storageId: file,
        sizeBytes: f.blob.size,
        sha256: "a".repeat(64),
        ...f.metadata,
      }),
    ).rejects.toThrow("no longer owns");
    expect(await f.t.run((ctx) => ctx.storage.get(file))).toBeNull();
    await f.t.run((ctx) =>
      ctx.db.patch(f.publicationId, { reservedBytes: 5 * 1024 * 1024 * 1024 }),
    );
    await expect(
      f.owner.mutation(internal.publishedExports.beginValidated, {
        ...f.beginArgs,
        requestId: "over-limit",
      }),
    ).rejects.toThrow("limit reached");
  });

  it("does not share unvalidated uploads and allows retry after invalid MP4 rejection", async () => {
    const f = await fixture();
    await expect(
      f.owner.action(api.exportSharing.create, {
        publicationId: f.publicationId,
        allowDownload: false,
      }),
    ).rejects.toThrow("ready");
    await expect(
      uploadPublication(
        f.ctx as never,
        f.publicationId,
        new Request("http://localhost/upload", {
          method: "POST",
          headers: { "Content-Type": "video/mp4" },
          body: "not a video",
        }),
      ),
    ).rejects.toThrow("MP4");
    expect((await f.t.run((ctx) => ctx.db.get(f.publicationId)))?.state).toBe(
      "failed",
    );
    await f.upload();
    expect((await f.t.run((ctx) => ctx.db.get(f.publicationId)))?.state).toBe(
      "ready",
    );
  });

  it("stores hashed link secrets/passwords and checks revocation for every media request", async () => {
    const f = await fixture();
    await f.upload();
    const created = await f.owner.action(api.exportSharing.create, {
      publicationId: f.publicationId,
      allowDownload: false,
      password: "private-password",
      expiresAt: Date.now() + 86400_000,
    });
    const secret = new URL(created.url).hash.slice(1);
    const row = (await f.t.run((ctx) => ctx.db.get(created.linkId)))!;
    expect(row.secretHash).toBe(hashSecret(secret));
    expect(row.passwordHash).not.toContain("private-password");
    const visible = await f.owner.query(api.exportSharing.list, {
      publicationId: f.publicationId,
    });
    expect(visible[0]).not.toHaveProperty("secretHash");
    expect(visible[0]).not.toHaveProperty("passwordHash");
    await expect(
      exchangeShare(f.ctx as never, created.linkId, secret, "wrong", "client"),
    ).rejects.toThrow("unavailable");
    expect(
      await f.t.run((ctx) => ctx.db.query("exportViewerSessions").collect()),
    ).toHaveLength(0);
    const session = await exchangeShare(
      f.ctx as never,
      created.linkId,
      secret,
      "private-password",
      "client",
    );
    const request = (download = false) =>
      new Request(`http://localhost/media${download ? "?download=1" : ""}`, {
        headers: {
          Cookie: `cinakey_share=${session.token}`,
          Range: "bytes=0-9",
        },
      });
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(f.bytes.slice(0, 10), {
        status: 206,
        headers: { "Content-Range": `bytes 0-9/${f.bytes.length}` },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const response = await serveSharedMedia(
      f.ctx as never,
      request(),
      created.linkId,
    );
    expect(response.status).toBe(206);
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(
      f.bytes.slice(0, 10),
    );
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(
      (await f.t.run((ctx) => ctx.db.query("egressEvents").collect())).some(
        (e) => e.kind === "share" && e.bytes === 10,
      ),
    ).toBe(true);
    await expect(
      serveSharedMedia(f.ctx as never, request(true), created.linkId),
    ).rejects.toThrow("Download access denied");
    await f.owner.mutation(api.exportSharing.revoke, {
      linkId: created.linkId,
    });
    await expect(
      serveSharedMedia(f.ctx as never, request(), created.linkId),
    ).rejects.toThrow("unavailable");
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("rejects guessed IDs, expired links/sessions and access removed from a Creator", async () => {
    const f = await fixture();
    await f.upload();
    const creatorId = await createTestUser(f.t, "creator@exports.test");
    const creator = f.t.withIdentity(authIdentity(creatorId));
    const assignment = await f.t.run(async (ctx) => {
      await ctx.db.insert("workspaceMembers", {
        workspaceId: f.project.workspaceId,
        userId: creatorId,
        role: "creator",
        createdAt: Date.now(),
      });
      return ctx.db.insert("productionAssignments", {
        workspaceId: f.project.workspaceId,
        userId: creatorId,
        projectId: f.projectId,
        manageReviews: false,
      });
    });
    const created = await creator.action(api.exportSharing.create, {
      publicationId: f.publicationId,
      allowDownload: true,
    });
    const secret = new URL(created.url).hash.slice(1);
    await expect(
      exchangeShare(
        f.ctx as never,
        created.linkId,
        "0".repeat(64),
        "",
        "client",
      ),
    ).rejects.toThrow();
    const session = await exchangeShare(
      f.ctx as never,
      created.linkId,
      secret,
      "",
      "client",
    );
    await f.t.run(async (ctx) => {
      await ctx.db.delete(assignment);
      const viewer = await ctx.db.query("exportViewerSessions").first();
      await ctx.db.patch(viewer!._id, { expiresAt: Date.now() - 1 });
    });
    await expect(
      creator.query(api.publishedExports.list, { projectId: f.projectId }),
    ).rejects.toThrow("access denied");
    await expect(
      creator.mutation(api.exportSharing.revoke, { linkId: created.linkId }),
    ).rejects.toThrow("access denied");
    await expect(
      f.owner.query(internal.exportSharing.authorizeViewer, {
        linkId: created.linkId,
        tokenHash: hashSecret(session.token),
        download: false,
      }),
    ).rejects.toThrow();
    await f.t.run((ctx) =>
      ctx.db.patch(created.linkId, { expiresAt: Date.now() - 1 }),
    );
    await expect(
      exchangeShare(f.ctx as never, created.linkId, secret, "", "client"),
    ).rejects.toThrow();
  });

  it("cleans abandoned staged uploads and removes stored files only by explicit deletion", async () => {
    const f = await fixture();
    const attempt = "abandoned";
    await f.owner.mutation(internal.publishedExports.claimUpload, {
      publicationId: f.publicationId,
      attempt,
    });
    const storageId = await f.t.run((ctx) => ctx.storage.store(f.blob));
    await f.owner.mutation(internal.publishedExports.stageUpload, {
      publicationId: f.publicationId,
      attempt,
      storageId,
    });
    await f.t.run((ctx) =>
      ctx.db.patch(f.publicationId, { expiresAt: Date.now() - 1 }),
    );
    await f.t.mutation(internal.publishedExports.cleanup, {});
    expect(await f.t.run((ctx) => ctx.storage.get(storageId))).toBeNull();
    expect(await f.t.run((ctx) => ctx.db.get(f.publicationId))).toBeNull();
    const second = await f.owner.mutation(
      internal.publishedExports.beginValidated,
      { ...f.beginArgs, requestId: "second" },
    );
    await uploadPublication(
      f.ctx as never,
      second,
      new Request("http://localhost/upload", {
        method: "POST",
        headers: { "Content-Type": "video/mp4" },
        body: f.bytes,
      }),
    );
    await f.owner.mutation(api.publishedExports.remove, {
      publicationId: second,
    });
    expect(
      await f.t.run((ctx) => ctx.db.query("publishedExports").collect()),
    ).toHaveLength(0);
  });
});
