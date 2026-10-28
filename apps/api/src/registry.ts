import type { Registry, ServiceOperation } from "./runtime/context";
import { services } from "./services";
export const registry: Registry = new Map();
for (const [module, exports] of Object.entries(services)) {
  for (const [name, value] of Object.entries(exports)) {
    if (
      value &&
      typeof value === "object" &&
      "kind" in value &&
      value.kind === "action"
    ) {
      const key = `${module}:${name}`;
      const operation = value as ServiceOperation;
      registry.set(key, operation);
    }
  }
}

// Preserve the existing public upload contracts while authorizing sessions in Convex.
import { createProjectUpload, createSeriesUpload } from "./services/r2Storage";
registry.set(
  "storage:createUploadUrl",
  createProjectUpload as unknown as ServiceOperation,
);
registry.set(
  "resources:createUploadUrl",
  createSeriesUpload as unknown as ServiceOperation,
);
