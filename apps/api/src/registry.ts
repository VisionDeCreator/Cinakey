import { services } from "./services";
import type { Registry, ServiceOperation } from "./runtime/context";
export const registry: Registry = new Map();
for (const [module, exports] of Object.entries(services)) {
  for (const [name, value] of Object.entries(exports)) {
    if (
      value &&
      typeof value === "object" &&
      "kind" in value &&
      value.kind === "action"
    )
      registry.set(`${module}:${name}`, value as ServiceOperation);
  }
}
