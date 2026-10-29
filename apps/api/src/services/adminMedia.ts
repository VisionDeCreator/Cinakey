import { v } from "convex/values";
import { action } from "../runtime/operation";
import { internal } from "../operations";
import { signDownload } from "./r2";
export const preview = action({
  args: { storageId: v.string(), reason: v.string(), requestId: v.string() },
  handler: async (
    ctx,
    args,
  ): Promise<{ url: string | null; contentType: string }> => {
    const selected = await ctx.runMutation(
      internal.adminMedia.previewContext,
      args,
    );
    const url =
      selected.key && selected.bucket
        ? await signDownload(selected.key, selected.bucket, false, 300)
        : selected.url;
    return { url, contentType: selected.contentType };
  },
});
