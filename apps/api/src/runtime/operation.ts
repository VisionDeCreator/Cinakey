import type { ActionBuilder, HttpActionBuilder } from "convex/server";
import type { DataModel } from "../../../../packages/backend/convex/_generated/dataModel";
export type { ActionCtx } from "../../../../packages/backend/convex/_generated/server";

/** Service definitions preserve the existing validated contracts without deploying actions. */
function defineOperation(visibility: "public" | "internal") {
  return (definition: { args: Record<string, unknown>; handler: unknown }) => ({
    kind: "action",
    visibility,
    args: definition.args,
    handler: definition.handler,
  });
}
export const action = defineOperation("public") as unknown as ActionBuilder<
  DataModel,
  "public"
>;
export const internalAction = defineOperation(
  "internal",
) as unknown as ActionBuilder<DataModel, "internal">;
export const httpAction = ((handler: unknown) => ({
  handler,
})) as unknown as HttpActionBuilder;

/** Runtime context routes media to R2 while retaining Convex JSON storage. */
export function mediaStorage(
  ctx: import("../../../../packages/backend/convex/_generated/server").ActionCtx,
) {
  return ctx.storage as unknown as {
    getUrl(
      id: import("../../../../packages/backend/convex/_generated/dataModel").Id<
        "_storage" | "r2Files"
      >,
    ): Promise<string | null>;
    get(
      id: import("../../../../packages/backend/convex/_generated/dataModel").Id<
        "_storage" | "r2Files"
      >,
    ): Promise<Blob | null>;
    store(
      blob: Blob,
    ): Promise<
      import("../../../../packages/backend/convex/_generated/dataModel").Id<
        "_storage" | "r2Files"
      >
    >;
    delete(
      id: import("../../../../packages/backend/convex/_generated/dataModel").Id<
        "_storage" | "r2Files"
      >,
    ): Promise<void>;
  };
}
