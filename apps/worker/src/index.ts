import { loadRootEnvironment } from "@cinakey/api/load-root-env";
import { validateProviderConfiguration } from "@cinakey/api/config";
import { runWorker } from "@cinakey/api/worker";
loadRootEnvironment();
validateProviderConfiguration();
const controller = new AbortController();
process.on("SIGINT", () => controller.abort());
process.on("SIGTERM", () => controller.abort());
await runWorker(controller.signal);
