import { runPromoteAdmin } from "../apps/api/src/cli/promote-admin";

process.exitCode = await runPromoteAdmin(process.argv.slice(2));
