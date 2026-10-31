import { makeFunctionReference } from "convex/server";
import { adminClient } from "../runtime/context";
import { polarConfiguration } from "./polar";
/** Sandbox and production money must never share an accidentally mismatched runtime. */
export async function validatePolarDeployment() {
  const config = polarConfiguration();
  if (!config.enabled) return;
  const deployed = await adminClient().query(
    makeFunctionReference<"query">("payments:deploymentEnvironment"),
    {},
  );
  if (
    deployed.environment !== config.environment ||
    deployed.paywall !== config.paywall ||
    (deployed.trialEnabled ?? false) !== config.trialEnabled
  )
    throw new Error(
      "Polar environment, SUBSCRIPTION_PAYWALL_ENABLED and WORKSPACE_TRIAL_ENABLED must match between API/worker and Convex before enabling payments",
    );
}
