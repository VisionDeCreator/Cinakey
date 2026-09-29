/**
 * Re-export part-document bridge (Phase 11D). Implementation in ../blockout/bridge.
 */
export type { LiveShotMeta } from "../blockout/bridge";
export {
  blockoutSheetToPartDocument,
  blockoutSheetToDocuments,
  blockoutDocumentToSheetShotPatch,
  createDefaultPartDocument,
} from "../blockout/bridge";
