import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";
import { generateUploadUrl, getFileUrl, deleteFile } from "./storage";
export const uploadUrl = internalMutation({
  args: {},
  handler: (ctx) => generateUploadUrl(ctx),
});
export const url = internalQuery({
  args: { id: v.id("_storage") },
  handler: (ctx, { id }) => getFileUrl(ctx, id),
});
export const remove = internalMutation({
  args: { id: v.id("_storage") },
  handler: (ctx, { id }) => deleteFile(ctx, id),
});
