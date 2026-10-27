import { expect, it } from "vitest";
import { cleanBillingReturnUrl } from "./billing-return";
it("discards every Polar portal bearer token while preserving the billing workspace and return state", () => {
  expect(
    cleanBillingReturnUrl(
      "https://app.example/billing/workspace?billing=returned&customer_session_token=secret-one&customer_session_token=secret-two#subscription",
    ),
  ).toBe("/billing/workspace?billing=returned#subscription");
});
it("does not rewrite ordinary application or authentication callback URLs", () => {
  expect(
    cleanBillingReturnUrl("https://app.example/billing?billing=returned"),
  ).toBeNull();
  expect(
    cleanBillingReturnUrl(
      "https://app.example/?code=oauth-code&state=oauth-state",
    ),
  ).toBeNull();
});
