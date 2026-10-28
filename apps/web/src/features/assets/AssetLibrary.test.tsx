import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { AssetLibrary } from "./AssetLibrary";
const m = vi.hoisted(() => ({ star: vi.fn().mockResolvedValue(null) }));
vi.mock("@cinakey/backend", () => ({
  api: {
    projects: { listMine: "projects" },
    assets: { filterOptions: "filters", list: "assets", setStarred: "star" },
    storage: { getAssetUrl: "url" },
  },
}));
vi.mock("./AssetDetailDrawer", () => ({
  AssetDetailDrawer: ({ open }: { open: boolean }) =>
    open ? <div role="dialog">Asset preview</div> : null,
}));
vi.mock("./useAssetUpload", () => ({
  useAssetUpload: () => ({ uploads: [], uploadFiles: vi.fn() }),
}));
vi.mock("@/lib/api/hooks", () => ({
  useMutation: () => m.star,
  useQuery: (ref: string, args: { type?: string; starredOnly?: boolean }) =>
    ref === "projects"
      ? [{ project: { _id: "project", title: "Test Project" } }]
      : ref === "filters"
        ? { tags: [], characters: [] }
        : ref === "assets"
          ? args.type === "video" || args.starredOnly
            ? []
            : [
                {
                  _id: "asset",
                  name: "Portrait",
                  type: "image",
                  starred: false,
                  tags: ["reference"],
                  updatedAt: 1,
                },
              ]
          : null,
}));
function setup() {
  render(
    <MemoryRouter>
      <AssetLibrary requireProject />
    </MemoryRouter>,
  );
}
describe("Assets library", () => {
  it("requires project selection for uploads and opens previews", async () => {
    setup();
    expect(
      screen.getByRole("button", { name: "Upload assets" }),
    ).toBeDisabled();
    await userEvent.click(
      screen.getByRole("button", { name: "Preview Portrait" }),
    );
    expect(screen.getByRole("dialog")).toHaveTextContent("Asset preview");
  });
  it("filters types, toggles favourites and switches view", async () => {
    setup();
    await userEvent.click(screen.getByRole("button", { name: "video" }));
    expect(screen.getByText("No matching assets.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "All assets" }));
    await userEvent.click(
      screen.getByRole("button", { name: "Add Portrait to favourites" }),
    );
    expect(m.star).toHaveBeenCalledWith({ assetId: "asset", starred: true });
    await userEvent.click(screen.getByRole("button", { name: "List view" }));
    expect(screen.getByRole("button", { name: "List view" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });
});
