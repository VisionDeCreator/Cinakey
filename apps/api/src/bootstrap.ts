import { loadRootEnvironment } from "./config/load-root-env";
import { validateProviderConfiguration } from "./config/env";
loadRootEnvironment();
validateProviderConfiguration();
await import("./index");
