import { validatePolarDeployment } from "./config/polar-startup";
import { loadRootEnvironment } from "./config/load-root-env";
import { validateProviderConfiguration } from "./config/env";
import { polarConfiguration } from "./config/polar";
loadRootEnvironment();
polarConfiguration();
validateProviderConfiguration();
await validatePolarDeployment();
await import("./index");
