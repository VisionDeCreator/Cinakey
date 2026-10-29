import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Id } from "@dirrio/backend";
import { AssetDetailDrawer } from "./AssetDetailDrawer";
const m = vi.hoisted(() => ({
  update: vi.fn(),
  remove: vi.fn(),
  confirm: vi.fn(),
}));
vi.mock("@dirrio/backend", () => ({
  api: {
    storage: { getAsset: "asset", getAssetUrl: "url" },
    assets: { update: "update", setStarred: "star", remove: "remove" },
  },
}));
vi.mock("@/components/use-confirm", () => ({ useConfirm: () => m.confirm }));
vi.mock("@/lib/api/hooks", () => ({
  useQuery: (ref: string) =>
    ref === "asset"
      ? {
          _id: "asset",
          name: "Portrait",
          type: "image",
          tags: ["reference"],
          sizeBytes: 1024,
          width: 1920,
          height: 1080,
          format: "image/png",
          createdAt: 1,
          starred: false,
        }
      : null,
  useMutation: (ref: string) =>
    ref === "update"
      ? m.update
      : ref === "remove"
        ? m.remove
        : vi.fn().mockResolvedValue(null),
}));
function setup() {
  render(
    <AssetDetailDrawer
      assetId={"asset" as Id<"assets">}
      open
      onOpenChange={vi.fn()}
    />,
  );
}
beforeEach(() => {
  vi.clearAllMocks();
  m.update.mockResolvedValue(null);
  m.confirm.mockResolvedValue(false);
});
describe("Asset details", () => {
  it("shows dimensions and saves trimmed metadata", async () => {
    setup();
    expect(screen.getByText("1920 × 1080")).toBeInTheDocument();
    await userEvent.clear(screen.getByRole("textbox", { name: "Name" }));
    expect(screen.getByRole("button", { name: "Save changes" })).toBeDisabled();
    await userEvent.type(
      screen.getByRole("textbox", { name: "Name" }),
      " Updated portrait ",
    );
    await userEvent.click(screen.getByRole("button", { name: "Save changes" }));
    expect(m.update).toHaveBeenCalledWith({
      assetId: "asset",
      name: "Updated portrait",
      tags: ["reference"],
    });
    expect(await screen.findByRole("status")).toHaveTextContent(
      "Changes saved.",
    );
  });
  it("keeps deletion behind the existing confirmation", async () => {
    setup();
    await userEvent.click(screen.getByRole("button", { name: "Delete asset" }));
    expect(m.confirm).toHaveBeenCalled();
    expect(m.remove).not.toHaveBeenCalled();
  });
  it("shows save errors in the drawer", async () => {
    m.update.mockRejectedValueOnce(new Error("Could not save"));
    setup();
    await userEvent.click(screen.getByRole("button", { name: "Save changes" }));
    expect(await screen.findByRole("status")).toHaveTextContent(
      "Could not save",
    );
  });
});
