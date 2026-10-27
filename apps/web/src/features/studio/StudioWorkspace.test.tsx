import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { getFunctionName } from "convex/server";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import { MediaPreview } from "./MediaPreview";
import { StudioWorkspace } from "./StudioWorkspace";
const state = vi.hoisted(() => ({
  assets: [
    { _id: "video", name: "Camera", type: "video", durationSec: undefined },
  ],
  footage: {
    videos: [
      {
        assetId: "video",
        name: "Camera",
        durationSec: null,
        url: "https://fixture.test/video.mp4",
        createdAt: 1,
        generated: true,
        starred: false,
      },
    ],
    jobs: [],
  },
}));
vi.mock("@/lib/api/hooks", () => ({
  useQuery: (ref: Parameters<typeof getFunctionName>[0]) => {
    switch (getFunctionName(ref)) {
      case "assets:list":
        return state.assets;
      case "workspace:list":
        return { migrated: true, script: null, scripts: [], staging: [] };
      case "workspace:videos":
        return state.footage;
      case "storage:listProjectAssetUrls":
        return [{ assetId: "video", url: "https://fixture.test/video.mp4" }];
      case "workspace:spend":
        return {
          remaining: 10_000_000,
          spentUsdMicros: 0,
          reservedUsdMicros: 0,
        };
      case "generation:estimateCost":
        return { usdMicros: 1_700_000 };
      default:
        return [];
    }
  },
  useAction: () => vi.fn().mockResolvedValue({ id: "script", text: "" }),
  useMutation: () => vi.fn(),
}));
vi.mock("@/components/use-confirm", () => ({ useConfirm: () => vi.fn() }));
vi.mock("@/features/assets/useAssetUpload", () => ({
  useAssetUpload: () => ({ uploads: [], uploadFiles: vi.fn() }),
}));
afterEach(cleanup);
it("shows unlinked footage without a script and inserts only the explicitly selected valid range", async () => {
  const insert = vi.fn();
  render(
    <MemoryRouter initialEntries={["/projects/p/studio"]}>
      <Routes>
        <Route
          path="/projects/:projectId/studio"
          element={
            <StudioWorkspace
              toolbar={<div />}
              viewer={<canvas />}
              timeline={<div />}
              inspector={<div />}
              selectedClip={null}
              onInsert={insert}
              onPreview={vi.fn()}
            />
          }
        />
      </Routes>
    </MemoryRouter>,
  );
  await act(async () => {});
  expect(
    screen.getByRole("button", { name: "Preview Camera" }),
  ).toBeInTheDocument();
  expect(insert).not.toHaveBeenCalled();
  expect(
    screen.getByRole("button", { name: "Add to timeline" }),
  ).toBeDisabled();
  const video = screen.getByLabelText("Camera") as HTMLVideoElement;
  Object.defineProperty(video, "duration", { value: 4 });
  fireEvent.loadedMetadata(video);
  expect(screen.getByLabelText("Source out")).toHaveValue(4);
  fireEvent.change(screen.getByLabelText("Source in"), {
    target: { value: "1" },
  });
  fireEvent.change(screen.getByLabelText("Source out"), {
    target: { value: "3" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Add to timeline" }));
  expect(insert).toHaveBeenCalledWith({
    assetId: "video",
    type: "video",
    durationSec: 2,
    inSec: 1,
    outSec: 3,
  });
});
it("offers playback recovery instead of leaving a blank viewer", () => {
  render(<MediaPreview url="https://fixture.test/video.mp4" name="Camera" />);
  fireEvent.error(screen.getByLabelText("Camera"));
  expect(
    screen.getByText("This media could not be played."),
  ).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Retry preview" }));
  expect(screen.getByLabelText("Camera")).toBeInTheDocument();
});

it("collapses each panel, supports keyboard resizing, and restores the saved layout", async () => {
  const store = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => store.set(key, value),
  });
  const workspace = () =>
    render(
      <MemoryRouter initialEntries={["/projects/p/studio"]}>
        <Routes>
          <Route
            path="/projects/:projectId/studio"
            element={
              <StudioWorkspace
                toolbar={<div />}
                viewer={<canvas />}
                timeline={<div />}
                inspector={<div />}
                selectedClip={null}
                onInsert={vi.fn()}
                onPreview={vi.fn()}
              />
            }
          />
        </Routes>
      </MemoryRouter>,
    );
  const first = workspace();
  await act(async () => {});
  fireEvent.pointerDown(screen.getByLabelText("Project timeline"));
  expect(
    screen.getByRole("button", { name: "Script & generation" }),
  ).toHaveAttribute("aria-pressed", "true");

  const divider = screen.getByRole("separator", { name: "Resize library" });
  fireEvent.keyDown(divider, { key: "ArrowRight" });
  expect(divider).toHaveAttribute("aria-valuenow", "230");
  for (const name of ["Library", "Inspector", "Generations", "Timeline"])
    fireEvent.click(screen.getByRole("button", { name }));
  expect(
    screen.queryByRole("region", { name: "Project timeline" }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("complementary", { name: "Project library" }),
  ).not.toBeInTheDocument();
  first.unmount();
  workspace();
  await act(async () => {});
  expect(screen.getByRole("button", { name: "Library" })).toHaveAttribute(
    "aria-pressed",
    "false",
  );
  fireEvent.click(screen.getByRole("button", { name: "Library" }));
  expect(
    screen.getByRole("separator", { name: "Resize library" }),
  ).toHaveAttribute("aria-valuenow", "230");
  fireEvent.click(screen.getByRole("button", { name: "Reset layout" }));
  expect(
    screen.getByRole("separator", { name: "Resize library" }),
  ).toHaveAttribute("aria-valuenow", "210");
});
