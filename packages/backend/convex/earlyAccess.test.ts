import { expect, it } from "vitest";
import { internal } from "../../../apps/api/src/operations";
import { makeTest } from "../test/helpers";
it("stores a normalized pending request once without granting access", async () => {
  const t = makeTest();
  const args = {
    email: " Creator@Example.com ",
    name: " Creator ",
    idea: " A film ",
    clientKey: "a".repeat(64),
  };
  await t.mutation(internal.earlyAccess.request, args);
  await t.mutation(internal.earlyAccess.request, args);
  await t.run(async (ctx) => {
    const rows = await ctx.db.query("earlyAccessRequests").collect();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      email: "creator@example.com",
      name: "Creator",
      idea: "A film",
      status: "pending",
    });
    expect(await ctx.db.query("users").collect()).toHaveLength(0);
  });
});
it("rejects invalid requests and limits repeated submissions", async () => {
  const t = makeTest();
  const args = {
    email: "creator@example.com",
    name: "",
    idea: "",
    clientKey: "b".repeat(64),
  };
  await expect(
    t.mutation(internal.earlyAccess.request, { ...args, email: "invalid" }),
  ).rejects.toThrow("Invalid request");
  for (let n = 0; n < 5; n++)
    await t.mutation(internal.earlyAccess.request, args);
  await expect(t.mutation(internal.earlyAccess.request, args)).rejects.toThrow(
    "Rate limit",
  );
});

import { api } from "../../../apps/api/src/operations";
import { authIdentity } from "../test/helpers";
import { verifiedEmailUser } from "./lib/authEmail";
import type { MutationCtx } from "./_generated/server";
it("requires approval for new verified emails and preserves existing users and staff", async () => {
  const t = makeTest();
  for (const status of [undefined, "pending", "rejected"] as const) {
    if (status)
      await t.run(async (ctx) => {
        const old = await ctx.db.query("earlyAccessRequests").first();
        if (old) await ctx.db.patch(old._id, { status });
        else
          await ctx.db.insert("earlyAccessRequests", {
            email: "new@example.com",
            name: "",
            idea: "",
            status,
            createdAt: Date.now(),
          });
      });
    await expect(
      t.run((ctx) => verifiedEmailUser(ctx as MutationCtx, "new@example.com")),
    ).rejects.toThrow("Waitlist approval");
  }
  for (const isStaff of [false, true]) {
    const email = `existing-${isStaff}@example.com`;
    const id = await t.run((ctx) => ctx.db.insert("users", { email, isStaff }));
    expect(
      await t.run((ctx) => verifiedEmailUser(ctx as MutationCtx, email)),
    ).toBe(id);
  }
  expect(await t.run((ctx) => ctx.db.query("users").collect())).toHaveLength(2);
});
it("reviews with permissions, audits, deduplicates, fences stale reviews and records conversion", async () => {
  const t = makeTest();
  const adminId = await t.run((ctx) =>
    ctx.db.insert("users", { email: "admin@example.com", isStaff: true }),
  );
  const supportId = await t.run((ctx) =>
    ctx.db.insert("users", { isStaff: true, adminRoles: ["support"] }),
  );
  const admin = t.withIdentity(authIdentity(adminId)),
    support = t.withIdentity(authIdentity(supportId));
  await t.mutation(internal.earlyAccess.request, {
    email: "new@example.com",
    name: "New",
    idea: "Film",
    clientKey: "a".repeat(64),
  });
  const row = (
    await admin.query(api.earlyAccess.list, {
      paginationOpts: { cursor: null, numItems: 25 },
    })
  ).page[0]!;
  const args = {
    id: row._id,
    status: "approved" as const,
    revision: 0,
    reason: "Acceptance test review",
    requestId: "approve-1",
  };
  await expect(support.mutation(api.earlyAccess.review, args)).rejects.toThrow(
    "permission",
  );
  await expect(t.query(api.earlyAccess.counts, {})).rejects.toThrow();
  await admin.mutation(api.earlyAccess.review, args);
  await admin.mutation(api.earlyAccess.review, args);
  await expect(
    admin.mutation(api.earlyAccess.review, { ...args, requestId: "stale" }),
  ).rejects.toThrow("changed");
  expect(await t.run((ctx) => ctx.db.query("apiTasks").collect())).toHaveLength(
    1,
  );
  expect(await t.run((ctx) => ctx.db.query("auditLog").collect())).toHaveLength(
    1,
  );
  await t.mutation(internal.earlyAccess.request, {
    email: " NEW@example.com ",
    name: "",
    idea: "",
    clientKey: "b".repeat(64),
  });
  expect((await t.run((ctx) => ctx.db.get(row._id)))?.status).toBe("approved");
  const id = await t.run((ctx) =>
    verifiedEmailUser(ctx as MutationCtx, "new@example.com"),
  );
  expect((await t.run((ctx) => ctx.db.get(row._id)))?.registeredUserId).toBe(
    id,
  );
  expect(await admin.query(api.earlyAccess.counts, {})).toMatchObject({
    total: 1,
    approved: 1,
    registered: 1,
    pending: 0,
  });
  await expect(
    admin.mutation(api.earlyAccess.review, {
      ...args,
      status: "rejected",
      revision: 1,
      requestId: "reject-existing",
    }),
  ).rejects.toThrow("suspension");
  // A stale email worker may not update the latest delivery generation.
  await t.mutation(internal.earlyAccess.recordDelivery, {
    id: row._id,
    generation: 0,
    sent: true,
  });
  expect((await t.run((ctx) => ctx.db.get(row._id)))?.emailDelivery).toBe(
    "queued",
  );
});

it("paginates and filters on the server, including normalized exact email search", async () => {
  const t = makeTest();
  const id = await t.run(async (ctx) => {
    const id = await ctx.db.insert("users", { isStaff: true });
    for (let i = 0; i < 30; i++)
      await ctx.db.insert("earlyAccessRequests", {
        email: `creator${i}@example.com`,
        name: "",
        idea: "",
        status: i % 2 ? "approved" : "pending",
        createdAt: i,
      });
    return id;
  });
  const admin = t.withIdentity(authIdentity(id));
  const first = await admin.query(api.earlyAccess.list, {
    paginationOpts: { numItems: 25, cursor: null },
  });
  expect(first.page).toHaveLength(25);
  expect(first.isDone).toBe(false);
  const second = await admin.query(api.earlyAccess.list, {
    paginationOpts: { numItems: 25, cursor: first.continueCursor },
  });
  expect(second.page).toHaveLength(5);
  expect(second.isDone).toBe(true);
  const approved = await admin.query(api.earlyAccess.list, {
    status: "approved",
    paginationOpts: { numItems: 25, cursor: null },
  });
  expect(approved.page).toHaveLength(15);
  expect(approved.page.every((r) => r.status === "approved")).toBe(true);
  const searched = await admin.query(api.earlyAccess.list, {
    email: " Creator9@Example.COM ",
    paginationOpts: { numItems: 25, cursor: null },
  });
  expect(searched.page.map((r) => r.email)).toEqual(["creator9@example.com"]);
  expect(
    (
      await admin.query(api.earlyAccess.list, {
        email: "creator9@example.com",
        status: "pending",
        paginationOpts: { numItems: 25, cursor: null },
      })
    ).page,
  ).toHaveLength(0);
});

it("allows decisions without reasons, preserves audit records and accepts short optional notes", async () => {
  const t = makeTest();
  const actor = await t.run((ctx) => ctx.db.insert("users", { isStaff: true }));
  const admin = t.withIdentity(authIdentity(actor));
  const id = await t.run((ctx) =>
    ctx.db.insert("earlyAccessRequests", {
      email: "optional@example.com",
      name: "",
      idea: "",
      status: "pending",
      reason: "Previous review note",
      createdAt: Date.now(),
    }),
  );
  await admin.mutation(api.earlyAccess.review, {
    id,
    status: "rejected",
    revision: 0,
    requestId: "reject-no-reason",
  });
  expect((await t.run((ctx) => ctx.db.get(id)))?.reason).toBeUndefined();
  await admin.mutation(api.earlyAccess.review, {
    id,
    status: "pending",
    revision: 1,
    requestId: "pending-no-reason",
    reason: "   ",
  });
  await admin.mutation(api.earlyAccess.review, {
    id,
    status: "approved",
    revision: 2,
    requestId: "approve-no-reason",
    reason: "",
  });
  const audits = await t.run((ctx) => ctx.db.query("auditLog").collect());
  expect(audits).toHaveLength(3);
  expect(
    audits.every(
      (row) => row.actorUserId === actor && row.reason === undefined,
    ),
  ).toBe(true);
  await admin.mutation(api.earlyAccess.review, {
    id,
    status: "approved",
    revision: 3,
    requestId: "resend",
    resend: true,
  });
  const resendAudit = await t.run((ctx) =>
    ctx.db.query("auditLog").order("desc").first(),
  );
  expect(resendAudit).toMatchObject({
    action: "waitlist.resend",
    actorUserId: actor,
  });
  expect(resendAudit?.reason).toBeUndefined();
  expect(await t.run((ctx) => ctx.db.query("apiTasks").collect())).toHaveLength(
    2,
  );
  await expect(
    admin.mutation(api.earlyAccess.review, {
      id,
      status: "pending",
      revision: 4,
      requestId: "long",
      reason: "x".repeat(2001),
    }),
  ).rejects.toThrow("2000");
  await admin.mutation(api.earlyAccess.review, {
    id,
    status: "pending",
    revision: 4,
    requestId: "short",
    reason: "OK",
  });
  expect((await t.run((ctx) => ctx.db.get(id)))?.reason).toBe("OK");
});
