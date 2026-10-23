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
