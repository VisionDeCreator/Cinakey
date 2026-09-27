/**
 * Public surface for apps: generated Convex api/dataModel and adapter registry.
 */
export { api } from "../convex/_generated/api.js";
export type { DataModel, Doc, Id } from "../convex/_generated/dataModel";
export { getAdapter, listAdapters } from "../convex/adapters/index.js";
export type { GenerationAdapter, ModelCapabilities } from "@cinakey/shared";
