import { expect, it } from "vitest";
import { paymentMetadata } from "./paymentMetadata";
it("matches historical receipt identities without rewriting provider receipts", () => {
  expect(paymentMetadata({ previous_intent: "checkout" }, "intent")).toBe(
    "checkout",
  );
  expect(paymentMetadata({ dirrio_intent: "checkout" }, "intent")).toBe(
    "checkout",
  );
  expect(paymentMetadata({ previous_refund: "refund" }, "refund")).toBe(
    "refund",
  );
});
it("fails closed on conflicting identities or malformed metadata", () => {
  expect(
    paymentMetadata({ previous_intent: "old", dirrio_intent: "new" }, "intent"),
  ).toBeUndefined();
  expect(paymentMetadata({ dirrio_intent: 42 }, "intent")).toBeUndefined();
  expect(paymentMetadata({ other: "irrelevant" }, "intent")).toBeUndefined();
});
