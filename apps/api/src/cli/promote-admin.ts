import { parseArgs } from "node:util";
import { ConvexError } from "convex/values";
import {
  getFunctionName,
  makeFunctionReference,
  type FunctionArgs,
  type FunctionReturnType,
} from "convex/server";
import { loadRootEnvironment } from "../config/load-root-env";
import { adminClient } from "../runtime/context";
import { internal } from "../operations";

const usage = `Usage: bun run admin:promote <email> [--reason "Reason for access"]

Promotes an existing verified account to platform administrator.
Uses CONVEX_URL and CONVEX_DEPLOY_KEY from the root .env (or process environment).
Requires the latest backend functions to be deployed. Safe to rerun.
Does not create an account or change workspace membership or billing.

Options:
  --reason <text>  Audit reason (3–500 characters; default: Operator admin setup)
  --help, -h       Show this help without loading credentials`;

export async function runPromoteAdmin(argv: string[]): Promise<number> {
  let email: string;
  let reason: string;
  try {
    const { values, positionals } = parseArgs({
      args: argv,
      allowPositionals: true,
      strict: true,
      options: {
        help: { type: "boolean", short: "h" },
        reason: { type: "string", default: "Operator admin setup" },
      },
    });
    if (values.help) {
      console.log(usage);
      return 0;
    }
    if (positionals.length !== 1) throw new Error("Expected one email");
    email = positionals[0]!.trim().toLowerCase();
    reason = values.reason!.trim();
    if (
      email.length > 254 ||
      !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email) ||
      reason.length < 3 ||
      reason.length > 500
    )
      throw new Error("Invalid arguments");
  } catch {
    console.error(
      "Provide one valid email and an audit reason of 3–500 characters.\n" +
        usage,
    );
    return 1;
  }

  try {
    loadRootEnvironment();
  } catch {
    console.error(
      "Cannot read root .env. Copy .env.example to .env and configure CONVEX_URL and CONVEX_DEPLOY_KEY.",
    );
    return 1;
  }
  if (!process.env.CONVEX_URL || !process.env.CONVEX_DEPLOY_KEY) {
    console.error(
      "CONVEX_URL and CONVEX_DEPLOY_KEY are required in the root .env or process environment.",
    );
    return 1;
  }

  try {
    const deployment = new URL(process.env.CONVEX_URL);
    if (
      deployment.username ||
      deployment.password ||
      deployment.search ||
      deployment.hash
    )
      throw new Error("Invalid deployment URL");
    const client = adminClient();
    console.log(`Deployment: ${deployment.origin}`);
    // ConvexHttpClient's types assume user auth; this client uses a deployment key.
    const promote = makeFunctionReference<
      "mutation",
      FunctionArgs<typeof internal.staff.promoteAdmin>,
      FunctionReturnType<typeof internal.staff.promoteAdmin>
    >(getFunctionName(internal.staff.promoteAdmin));
    const result = await client.mutation(promote, {
      email,
      reason,
    });
    console.log(
      result.alreadyAdmin
        ? `${result.email} is already a platform administrator. No changes made.`
        : `Promoted ${result.email} to platform administrator. Audit entry recorded.`,
    );
    console.log(
      "Sign in to the admin panel with that email, or reload it if already signed in.",
    );
    return 0;
  } catch (error) {
    // Do not print transport errors or stacks that could contain deployment credentials.
    console.error(
      error instanceof ConvexError && typeof error.data === "string"
        ? error.data
        : "Promotion failed. Check deployment access, network connectivity, and that the latest backend functions are deployed.",
    );
    return 1;
  }
}
