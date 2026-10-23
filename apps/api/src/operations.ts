import {
  anyApi,
  type ApiFromModules,
  type FilterApi,
  type FunctionReference,
} from "convex/server";
type Operations = ApiFromModules<{
  assets: typeof import("../../../packages/backend/convex/assets");
  blockouts: typeof import("../../../packages/backend/convex/blockouts") &
    typeof import("./services/blockouts");
  copilot: typeof import("../../../packages/backend/convex/copilot") &
    typeof import("./services/copilot");
  credits: typeof import("../../../packages/backend/convex/credits");
  egress: typeof import("../../../packages/backend/convex/egress");
  email: typeof import("../../../packages/backend/convex/email") &
    typeof import("./services/email");
  entities: typeof import("../../../packages/backend/convex/entities") &
    typeof import("./services/entities");
  exports: typeof import("../../../packages/backend/convex/exports");
  generation: typeof import("../../../packages/backend/convex/generation") &
    typeof import("./services/generation");
  migrations: typeof import("../../../packages/backend/convex/migrations") &
    typeof import("./services/migrations");
  moderation: typeof import("../../../packages/backend/convex/moderation");
  notifications: typeof import("../../../packages/backend/convex/notifications");
  onboarding: typeof import("../../../packages/backend/convex/onboarding") &
    typeof import("./services/onboarding");
  projects: typeof import("../../../packages/backend/convex/projects");
  promptSheets: typeof import("../../../packages/backend/convex/promptSheets") &
    typeof import("./services/promptSheets");
  proposals: typeof import("../../../packages/backend/convex/proposals") &
    typeof import("./services/proposals");
  scenes: typeof import("../../../packages/backend/convex/scenes");
  scriptVersions: typeof import("../../../packages/backend/convex/scriptVersions") &
    typeof import("./services/scriptVersions");
  seed: typeof import("../../../packages/backend/convex/seed");
  sequences: typeof import("../../../packages/backend/convex/sequences") &
    typeof import("./services/sequences");
  shotGeneration: typeof import("../../../packages/backend/convex/shotGeneration") &
    typeof import("./services/shotGeneration");
  shots: typeof import("../../../packages/backend/convex/shots") &
    typeof import("./services/shots");
  staff: typeof import("../../../packages/backend/convex/staff");
  staging: typeof import("../../../packages/backend/convex/staging") &
    typeof import("./services/staging");
  stagingFeedback: typeof import("../../../packages/backend/convex/stagingFeedback") &
    typeof import("./services/stagingFeedback");
  storage: typeof import("../../../packages/backend/convex/storage") &
    typeof import("./services/storage");
  takes: typeof import("../../../packages/backend/convex/takes");
  timelineVersions: typeof import("../../../packages/backend/convex/timelineVersions") &
    typeof import("./services/timelineVersions");
  users: typeof import("../../../packages/backend/convex/users");
}>;
export const api = anyApi as unknown as FilterApi<
  Operations,
  FunctionReference<any, "public">
>;
export const internal = anyApi as unknown as FilterApi<
  Operations,
  FunctionReference<any, "internal">
>;
