import { makeFunctionReference } from "convex/server";
import { adminClient } from "../runtime/context";
import { polarConfiguration } from "./polar";
import { useMockProviders } from "./env";
/** Sandbox and production money must never share an accidentally mismatched runtime. */
export async function validatePolarDeployment() {
  const config = polarConfiguration();
  if (!config.enabled) return;
  if (config.environment === "sandbox" && !useMockProviders())
    throw new Error(
      "Polar sandbox payments require USE_MOCK_ADAPTERS=true in API/worker and Convex; test balances cannot fund live generation",
    );
  const deployed = await adminClient().query(
    makeFunctionReference<"query">("payments:deploymentEnvironment"),
    {},
  );
  if (
    deployed.environment !== config.environment ||
    deployed.mock !== useMockProviders() ||
    deployed.paywall !== config.paywall
  )
    throw new Error(
      "Polar environment, USE_MOCK_ADAPTERS and SUBSCRIPTION_PAYWALL_ENABLED must match between API/worker and Convex before enabling payments",
    );
}
