import { runPromoteAdmin } from "./promote-admin";
process.exitCode = await runPromoteAdmin(process.argv.slice(2));
