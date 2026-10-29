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
