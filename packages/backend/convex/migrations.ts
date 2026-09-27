import { internalMutation } from "./_generated/server";
import { buildSearchText } from "./lib/assetSearch";

/**
 * One-shot Phase 4 backfill: asset name/searchText + structured project brief.
 * Run: `npx convex run migrations:migratePhase4`
 */
export const migratePhase4 = internalMutation({
  args: {},
  handler: async (ctx) => {
    let assetsPatched = 0;
    let projectsPatched = 0;

    const assets = await ctx.db.query("assets").collect();
    for (const asset of assets) {
      const row = asset as typeof asset & {
        name?: string;
        searchText?: string;
      };
      if (row.name !== undefined && row.searchText !== undefined) {
        continue;
      }
      const name = row.name?.trim() || `Untitled ${asset.type}`;
      await ctx.db.patch(asset._id, {
        name,
        searchText: buildSearchText(name, asset.tags ?? []),
      });
      assetsPatched += 1;
    }

    const projects = await ctx.db.query("projects").collect();
    for (const project of projects) {
      const brief = (project as { brief?: unknown }).brief;
      if (typeof brief === "string") {
        await ctx.db.patch(project._id, {
          brief: {
            logline: brief,
          },
        });
        projectsPatched += 1;
      }
    }

    return { assetsPatched, projectsPatched };
  },
});
