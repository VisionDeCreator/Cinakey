/**
 * Public surface for apps: typed HTTP operation references, data model and adapter types.
 * Provider implementations and keys live in the Bun API/worker.
 */
export { api } from "../../../apps/api/src/operations";
export type { DataModel, Doc, Id } from "../convex/_generated/dataModel";
export type { GenerationAdapter, ModelCapabilities } from "@dirrio/shared";
