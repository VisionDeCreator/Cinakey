import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { getFunctionName } from "convex/server";
import { afterEach, expect, it, vi } from "vitest";
import { type TimelineClip } from "@dirrio/shared";
import { ClipInspector } from "./ClipInspector";

vi.mock("@/lib/api/hooks", () => ({
  useQuery: (ref: Parameters<typeof getFunctionName>[0]) =>
    getFunctionName(ref) === "assets:list"
      ? [
          { _id: "a", name: "Desert.png", type: "image" },
          { _id: "b", name: "Mountain.png", type: "image" },
        ]
      : [],
}));
afterEach(cleanup);
const clip: TimelineClip = {
  id: "c",
  source: { type: "asset", assetId: "a" },
  startSec: 0,
  durationSec: 8,
  inSec: 0,
  outSec: 8,
  speed: 1,
  volume: 1,
};

it("keeps volume percentages mapped to engine gain and preserves trim math", () => {
  const change = vi.fn();
  render(
    <ClipInspector
      projectId="p"
      clip={clip}
      onChange={change}
      onDelete={vi.fn()}
    />,
  );
  expect(screen.getByText("100%")).toBeInTheDocument();
  fireEvent.change(screen.getByRole("slider", { name: "Volume" }), {
    target: { value: "1.5" },
  });
  expect(change).toHaveBeenLastCalledWith({ volume: 1.5 });
  fireEvent.change(screen.getByLabelText("Source in (seconds)"), {
    target: { value: "2" },
  });
  expect(change).toHaveBeenLastCalledWith({ inSec: 2, outSec: 10 });
});

it("replaces a source through the shared select while keeping clip timing", async () => {
  HTMLElement.prototype.scrollIntoView = vi.fn();
  HTMLElement.prototype.hasPointerCapture = vi.fn(() => false);
  HTMLElement.prototype.setPointerCapture = vi.fn();
  HTMLElement.prototype.releasePointerCapture = vi.fn();
  const change = vi.fn();
  const user = userEvent.setup();
  render(
    <ClipInspector
      projectId="p"
      clip={clip}
      onChange={change}
      onDelete={vi.fn()}
    />,
  );
  await user.click(
    screen.getByRole("combobox", { name: "Replace clip source" }),
  );
  await user.click(screen.getByRole("option", { name: "Mountain.png" }));
  expect(change).toHaveBeenCalledWith(
    expect.objectContaining({
      source: { type: "asset", assetId: "b", proxyAssetId: undefined },
      durationSec: 8,
    }),
  );
});

it("shows guidance when no clip is selected", () => {
  render(
    <ClipInspector
      projectId="p"
      clip={null}
      onChange={vi.fn()}
      onDelete={vi.fn()}
    />,
  );
  expect(screen.getByText(/Select a clip in the timeline/)).toBeInTheDocument();
  expect(screen.queryByRole("slider")).not.toBeInTheDocument();
});
