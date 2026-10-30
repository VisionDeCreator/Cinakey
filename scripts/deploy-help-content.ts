import { runHelpContent } from "../apps/api/src/cli/help-content";
process.exitCode = await runHelpContent(process.argv.slice(2));
