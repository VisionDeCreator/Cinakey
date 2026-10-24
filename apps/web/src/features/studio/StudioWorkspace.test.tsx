import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { getFunctionName } from "convex/server";
import { afterEach, expect, it, vi } from "vitest";
import { StudioWorkspace } from "./StudioWorkspace";
import { MediaPreview } from "./MediaPreview";
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
        sequenceId: null,
        shotId: null,
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
      case "shotGeneration:listProjectVideos":
        return state.footage;
      case "storage:listProjectAssetUrls":
        return [{ assetId: "video", url: "https://fixture.test/video.mp4" }];
      case "shotGeneration:getProjectSpend":
        return { remaining: 100 };
      default:
        return [];
    }
  },
  useAction: () => vi.fn(),
  useMutation: () => vi.fn(),
}));
vi.mock("@/components/ConfirmProvider", () => ({ useConfirm: () => vi.fn() }));
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
    shotId: undefined,
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
