import { render, screen } from "@testing-library/react";
import { getFunctionName } from "convex/server";
import { describe, expect, it, vi } from "vitest";
import { PromptWorkbench } from "./PromptWorkbench";

vi.mock("@/lib/api/hooks", () => ({
  useAction: () => vi.fn(),
  useQuery: (ref: Parameters<typeof getFunctionName>[0]) => {
    const name = getFunctionName(ref);
    if (
      name.includes("listVersions") ||
      name.includes("listAssets") ||
      name.includes("listProjectAssets")
    )
      return [];
    return null;
  },
}));
vi.mock("@/features/assets/useAssetUpload", () => ({
  useAssetUpload: () => ({ uploadFiles: vi.fn() }),
}));

describe("reference workbench", () => {
  it("keeps uploads and library selection without chat or image generation controls", () => {
    render(
      <PromptWorkbench
        projectId="p"
        entityId="e"
        entityName="Hero"
        assetType="character"
      />,
    );
    expect(screen.getByRole("button", { name: "Upload" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Library" })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Clear references" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("textbox")).toHaveAttribute(
      "placeholder",
      "Add reference notes and a description…",
    );
    expect(
      screen.queryByRole("button", { name: /generate|send|fill from script/i }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("Chat")).not.toBeInTheDocument();
  });
});
