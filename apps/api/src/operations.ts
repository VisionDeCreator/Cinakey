import {
  anyApi,
  type ApiFromModules,
  type FilterApi,
  type FunctionReference,
} from "convex/server";
type Operations = ApiFromModules<{
  workspace: typeof import("../../../packages/backend/convex/workspace") &
    typeof import("./services/workspace");
  series: typeof import("../../../packages/backend/convex/series");
  references: typeof import("../../../packages/backend/convex/references");
  resources: typeof import("../../../packages/backend/convex/resources");
  assets: typeof import("../../../packages/backend/convex/assets");

  textJobs: typeof import("../../../packages/backend/convex/textJobs");
  credits: typeof import("../../../packages/backend/convex/credits");
  egress: typeof import("../../../packages/backend/convex/egress");
  email: typeof import("../../../packages/backend/convex/email") &
    typeof import("./services/email");
  entities: typeof import("../../../packages/backend/convex/entities") &
    typeof import("./services/entities");
  exports: typeof import("../../../packages/backend/convex/exports");
  generation: typeof import("../../../packages/backend/convex/generation") &
    typeof import("./services/generation");

  moderation: typeof import("../../../packages/backend/convex/moderation");
  notifications: typeof import("../../../packages/backend/convex/notifications");
  onboarding: typeof import("../../../packages/backend/convex/onboarding");
  projects: typeof import("../../../packages/backend/convex/projects");
  promptSheets: typeof import("../../../packages/backend/convex/promptSheets") &
    typeof import("./services/promptSheets");

  staff: typeof import("../../../packages/backend/convex/staff");
  staging: typeof import("../../../packages/backend/convex/staging") &
    typeof import("./services/staging");

  storage: typeof import("../../../packages/backend/convex/storage") &
    typeof import("./services/storage");

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
