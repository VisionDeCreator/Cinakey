import { describe, expect, it } from "vitest";
import { api } from "../../../apps/api/src/operations";
import { makeTest, createTestUser, authIdentity } from "../test/helpers";

describe("production/media/finance permission matrix", () => {
  it.each([
    ["owner", true, true],
    ["admin", true, true],
    ["assigned creator", true, false],
    ["unassigned creator", false, false],
    ["reviewer", false, false],
    ["outside staff", false, false],
  ] as const)(
    "enforces %s access on direct endpoint calls",
    async (role, productionAllowed, financeAllowed) => {
      const t = makeTest();
      const ownerId = await createTestUser(t, "owner@matrix.test");
      const owner = t.withIdentity(authIdentity(ownerId));
      const projectId = await owner.mutation(api.projects.create, {
        title: "Protected",
      });
      const project = (await owner.query(api.projects.get, { projectId }))!;
      const actorId =
        role === "owner"
          ? ownerId
          : await createTestUser(
              t,
              `${role.replaceAll(" ", "-")}@matrix.test`,
              { isStaff: role === "outside staff" },
            );
      if (role !== "owner" && role !== "outside staff")
        await t.run((ctx) =>
          ctx.db.insert("workspaceMembers", {
            workspaceId: project.workspaceId,
            userId: actorId,
            role:
              role === "admin"
                ? "admin"
                : role === "reviewer"
                  ? "reviewer"
                  : "creator",
            createdAt: Date.now(),
          }),
        );
      if (role === "assigned creator")
        await t.run((ctx) =>
          ctx.db.insert("productionAssignments", {
            workspaceId: project.workspaceId,
            userId: actorId,
            projectId,
            manageReviews: false,
          }),
        );
      const storageId = await t.run((ctx) =>
        ctx.storage.store(new Blob(["image"], { type: "image/png" })),
      );
      const assetId = await owner.mutation(api.storage.createAssetFromUpload, {
        projectId,
        storageId,
        type: "image",
        name: "reference.png",
        format: "image/png",
      });
      const actor = t.withIdentity(authIdentity(actorId));
      const productionReads = [
        () => actor.query(api.workspace.list, { projectId }),
        () => actor.query(api.timelineVersions.listForProject, { projectId }),
        () => actor.query(api.assets.list, { projectId }),
        () => actor.query(api.storage.getAssetUrl, { assetId }),
        () => actor.query(api.publishedExports.list, { projectId }),
        () => actor.query(api.promptSheets.listTips, { projectId }),
      ];
      for (const read of productionReads) {
        if (productionAllowed) await expect(read()).resolves.toBeDefined();
        else await expect(read()).rejects.toThrow("access denied");
      }
      const finances = actor.query(api.billing.getBalance, {
        workspaceId: project.workspaceId,
      });
      if (financeAllowed) await expect(finances).resolves.toBeDefined();
      else await expect(finances).rejects.toThrow("Workspace access denied");
    },
  );
});
