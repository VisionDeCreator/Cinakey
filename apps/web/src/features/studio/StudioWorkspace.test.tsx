import { WorkspaceContext } from "@/features/workspaces/workspace-context";
import userEvent from "@testing-library/user-event";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { getFunctionName } from "convex/server";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import { MediaPreview } from "./MediaPreview";
import { StudioWorkspace } from "./StudioWorkspace";
const state = vi.hoisted(() => ({
  queries: vi.fn(),
  archivedSegments: [] as {
    _id: string;
    title: string;
    durationSec: number;
    versionCount: number;
  }[],
  confirm: vi.fn().mockResolvedValue(false),
  settingsBySegment: {} as Record<
    string,
    {
      resolution: string;
      durationSec: number;
      aspectRatio: string;
      useStaging: boolean;
      revision: number;
    }
  >,
  segments: [
    {
      _id: "defaultSegment",
      title: "Segment 1",
      durationSec: 5,
      versionCount: 1,
    },
  ] as {
    _id: string;
    title: string;
    durationSec: number;
    versionCount: number;
  }[],
  settings: {
    resolution: "720p",
    durationSec: 5,
    aspectRatio: "16:9",
    useStaging: false,
    revision: 1,
  } as {
    resolution: string;
    durationSec: number;
    aspectRatio: string;
    useStaging: boolean;
    revision: number;
    stagingId?: string;
  },
  mutation: vi.fn().mockResolvedValue({
    resolution: "720p",
    durationSec: 5,
    aspectRatio: "16:9",
    useStaging: false,
    revision: 2,
  }),
  staging: [] as { _id: string; name: string; previzAssetId?: string }[],
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
  useQuery: (ref: Parameters<typeof getFunctionName>[0], args: unknown) => {
    state.queries(getFunctionName(ref), args);
    switch (getFunctionName(ref)) {
      case "projects:generationSettings":
        return (
          state.settingsBySegment[
            (args as { segmentId?: string })?.segmentId ?? ""
          ] ?? state.settings
        );
      case "assets:list":
        return state.assets;
      case "workspace:list":
        return {
          migrated: true,
          script: null,
          scripts: [],
          staging: state.staging,
          segments: state.segments,
          archivedSegments: state.archivedSegments,
        };
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
  useMutation: () => state.mutation,
}));
vi.mock("@/components/use-confirm", () => ({
  useConfirm: () => state.confirm,
}));
vi.mock("@/features/assets/useAssetUpload", () => ({
  useAssetUpload: () => ({ uploads: [], uploadFiles: vi.fn() }),
}));
vi.mock("@/features/blockout/BlockoutPage", () => ({
  BlockoutPage: ({
    onUseForGeneration,
  }: {
    onUseForGeneration: (id: string) => void;
  }) => (
    <button onClick={() => onUseForGeneration("s1")}>Use test staging</button>
  ),
}));
afterEach(() => {
  cleanup();
  state.staging = [];
  state.segments = [
    {
      _id: "defaultSegment",
      title: "Segment 1",
      durationSec: 5,
      versionCount: 1,
    },
  ];
  state.queries.mockClear();
  state.archivedSegments = [];
  state.confirm.mockReset().mockResolvedValue(false);
  state.settingsBySegment = {};
  state.mutation.mockReset().mockResolvedValue({
    resolution: "720p",
    durationSec: 5,
    aspectRatio: "16:9",
    useStaging: false,
    revision: 2,
  });
  state.settings = {
    resolution: "720p",
    durationSec: 5,
    aspectRatio: "16:9",
    useStaging: false,
    revision: 1,
  };
});
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
  fireEvent.change(
    screen.getByRole("textbox", { name: "Search project media" }),
    { target: { value: "missing footage" } },
  );
  expect(screen.getByText("No media matches your filters.")).toBeVisible();
  fireEvent.change(
    screen.getByRole("textbox", { name: "Search project media" }),
    { target: { value: "" } },
  );
  fireEvent.click(screen.getByRole("button", { name: "Images" }));
  expect(screen.getByText("No media matches your filters.")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "All" }));
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
  expect(screen.getByRole("button", { name: "Script" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );

  // Both views share the same controls; switching never resets settings or the script.
  const slider = screen.getByRole("slider", { name: "Generation duration" });
  fireEvent.change(slider, { target: { value: "12" } });
  fireEvent.click(screen.getByRole("button", { name: "Generation" }));
  expect(
    screen.getByRole("slider", { name: "Generation duration" }),
  ).toHaveValue("12");
  expect(
    screen.queryByRole("textbox", { name: "Script" }),
  ).not.toBeInTheDocument();
  fireEvent.change(slider, { target: { value: "9" } });
  fireEvent.click(screen.getByRole("button", { name: "Script" }));
  expect(
    screen.getByRole("slider", { name: "Generation duration" }),
  ).toHaveValue("9");
  expect(screen.getByRole("textbox", { name: "Script" })).toBeVisible();

  const divider = screen.getByRole("separator", { name: "Resize library" });
  fireEvent.keyDown(divider, { key: "ArrowRight" });
  expect(divider).toHaveAttribute("aria-valuenow", "350");
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
  ).toHaveAttribute("aria-valuenow", "350");
  fireEvent.click(screen.getByRole("button", { name: "Reset layout" }));
  expect(
    screen.getByRole("separator", { name: "Resize library" }),
  ).toHaveAttribute("aria-valuenow", "330");
});

it("opens the generation inspector with the chosen staging reference enabled", async () => {
  state.staging = [
    { _id: "s1", name: "Desert crossing", previzAssetId: "preview" },
  ];
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
  await act(async () => {});
  fireEvent.click(screen.getByRole("button", { name: "Staging" }));
  fireEvent.click(screen.getByRole("button", { name: "Use test staging" }));
  expect(screen.getByRole("button", { name: "Generation" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  expect(
    screen.getByRole("checkbox", { name: "Use staging as video reference" }),
  ).toBeChecked();
  expect(
    screen.getByRole("combobox", { name: "Generation staging" }),
  ).toHaveTextContent("Desert crossing");
});

it("loads saved generation settings and persists edits without changing project output settings", async () => {
  Element.prototype.scrollIntoView = vi.fn();
  state.settings = {
    resolution: "1080p",
    durationSec: 8,
    aspectRatio: "9:16",
    useStaging: false,
    revision: 3,
  };
  state.mutation.mockClear();
  state.mutation.mockResolvedValueOnce({
    ...state.settings,
    aspectRatio: "1:1",
    revision: 4,
  });
  render(
    <MemoryRouter initialEntries={["/projects/p/studio"]}>
      <Routes>
        <Route
          path="/projects/:projectId/studio"
          element={
            <StudioWorkspace
              toolbar={null}
              viewer={null}
              timeline={null}
              inspector={null}
              selectedClip={null}
              onInsert={vi.fn()}
              onPreview={vi.fn()}
            />
          }
        />
      </Routes>
    </MemoryRouter>,
  );
  expect(
    screen.getByRole("combobox", { name: "Resolution" }),
  ).toHaveTextContent("1080p");
  expect(
    screen.getByRole("slider", { name: "Generation duration" }),
  ).toHaveValue("8");
  fireEvent.keyDown(screen.getByRole("combobox", { name: "Aspect ratio" }), {
    key: "ArrowDown",
  });
  fireEvent.click(screen.getByRole("option", { name: "1:1" }));
  await waitFor(() =>
    expect(state.mutation).toHaveBeenCalledWith({
      projectId: "p",
      segmentId: "defaultSegment",
      aspectRatio: "1:1",
    }),
  );
  expect(
    screen.getByRole("combobox", { name: "Aspect ratio" }),
  ).toHaveTextContent("1:1");
  state.settings = {
    resolution: "720p",
    durationSec: 5,
    aspectRatio: "16:9",
    useStaging: false,
    revision: 1,
  };
});

it("does not replay an old staging URL over a collaborator's later preference change", async () => {
  state.staging = [
    { _id: "s1", name: "Desert crossing", previzAssetId: "preview" },
  ];
  state.settings = {
    resolution: "720p",
    durationSec: 5,
    aspectRatio: "16:9",
    useStaging: true,
    stagingId: "s1",
    revision: 2,
  };
  state.mutation.mockClear();
  const editor = () => (
    <MemoryRouter
      initialEntries={["/projects/p/studio?staging=s1&stagingReference=1"]}
    >
      <Routes>
        <Route
          path="/projects/:projectId/studio"
          element={
            <StudioWorkspace
              toolbar={null}
              viewer={null}
              timeline={null}
              inspector={null}
              selectedClip={null}
              onInsert={vi.fn()}
              onPreview={vi.fn()}
            />
          }
        />
      </Routes>
    </MemoryRouter>
  );
  const view = render(editor());
  await act(async () => {});
  expect(
    screen.getByRole("checkbox", { name: "Use staging as video reference" }),
  ).toBeChecked();
  state.settings = { ...state.settings, useStaging: false, revision: 3 };
  view.rerender(editor());
  await act(async () => {});
  expect(
    screen.getByRole("checkbox", { name: "Use staging as video reference" }),
  ).not.toBeChecked();
  expect(state.mutation).not.toHaveBeenCalled();
});

it("opens the selected segment and switches its editor with a segment-scoped query", async () => {
  state.segments = [
    { _id: "opening", title: "Opening", durationSec: 30, versionCount: 2 },
    { _id: "ending", title: "Ending", durationSec: 30, versionCount: 1 },
  ];
  render(
    <MemoryRouter initialEntries={["/projects/p/studio?segment=ending"]}>
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
  await act(async () => {});
  expect(screen.getByRole("combobox", { name: "Script segment" })).toHaveValue(
    "ending",
  );
  expect(state.queries).toHaveBeenCalledWith("workspace:list", {
    projectId: "p",
    segmentId: "ending",
  });
  fireEvent.change(screen.getByRole("combobox", { name: "Script segment" }), {
    target: { value: "opening" },
  });
  await waitFor(() =>
    expect(
      screen.getByRole("combobox", { name: "Script segment" }),
    ).toHaveValue("opening"),
  );
  expect(state.queries).toHaveBeenCalledWith("workspace:list", {
    projectId: "p",
    segmentId: "opening",
  });
});

function renderSegmentSettings(single = false) {
  state.segments = [
    { _id: "opening", title: "Opening", durationSec: 8, versionCount: 1 },
    { _id: "ending", title: "Ending", durationSec: 20, versionCount: 1 },
  ];
  if (single) state.segments = state.segments.slice(0, 1);
  state.settingsBySegment = {
    opening: {
      resolution: "720p",
      durationSec: 8,
      aspectRatio: "16:9",
      useStaging: false,
      revision: 1,
    },
    ending: {
      resolution: "1080p",
      durationSec: 20,
      aspectRatio: "9:16",
      useStaging: false,
      revision: 1,
    },
  };
  return render(
    <MemoryRouter initialEntries={["/projects/p/studio?segment=opening"]}>
      <Routes>
        <Route
          path="/projects/:projectId/studio"
          element={
            <StudioWorkspace
              toolbar={null}
              viewer={null}
              timeline={null}
              inspector={null}
              selectedClip={null}
              onInsert={vi.fn()}
              onPreview={vi.fn()}
            />
          }
        />
      </Routes>
    </MemoryRouter>,
  );
}
it("flushes the old segment before switching and restores each segment's settings", async () => {
  let finish!: (result: typeof state.settings) => void;
  state.mutation.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  renderSegmentSettings();
  await act(async () => {});
  fireEvent.change(
    screen.getByRole("slider", { name: "Generation duration" }),
    { target: { value: "12" } },
  );
  fireEvent.change(screen.getByRole("combobox", { name: "Script segment" }), {
    target: { value: "ending" },
  });
  await waitFor(() =>
    expect(state.mutation).toHaveBeenCalledWith({
      projectId: "p",
      segmentId: "opening",
      durationSec: 12,
    }),
  );
  expect(screen.getByRole("combobox", { name: "Script segment" })).toHaveValue(
    "opening",
  );
  await act(async () => {
    state.settingsBySegment.opening = {
      ...state.settingsBySegment.opening!,
      durationSec: 12,
      revision: 2,
    };
    finish(state.settingsBySegment.opening);
  });
  await waitFor(() =>
    expect(
      screen.getByRole("combobox", { name: "Script segment" }),
    ).toHaveValue("ending"),
  );
  expect(
    screen.getByRole("slider", { name: "Generation duration" }),
  ).toHaveValue("20");
  expect(
    screen.getByRole("combobox", { name: "Resolution" }),
  ).toHaveTextContent("1080p");
  fireEvent.change(screen.getByRole("combobox", { name: "Script segment" }), {
    target: { value: "opening" },
  });
  await waitFor(() =>
    expect(
      screen.getByRole("slider", { name: "Generation duration" }),
    ).toHaveValue("12"),
  );
  expect(
    screen.queryByRole("spinbutton", { name: "Segment duration" }),
  ).not.toBeInTheDocument();
});
it("keeps the current segment and its settings draft when saving fails, with a retry", async () => {
  state.mutation.mockRejectedValueOnce(new Error("offline"));
  renderSegmentSettings();
  await act(async () => {});
  fireEvent.change(
    screen.getByRole("slider", { name: "Generation duration" }),
    { target: { value: "14" } },
  );
  fireEvent.change(screen.getByRole("combobox", { name: "Script segment" }), {
    target: { value: "ending" },
  });
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "Retry save" }),
    ).toBeInTheDocument(),
  );
  expect(screen.getByRole("combobox", { name: "Script segment" })).toHaveValue(
    "opening",
  );
  expect(
    screen.getByRole("slider", { name: "Generation duration" }),
  ).toHaveValue("14");
  state.mutation.mockResolvedValueOnce({
    ...state.settingsBySegment.opening,
    durationSec: 14,
    revision: 2,
  });
  fireEvent.click(screen.getByRole("button", { name: "Retry save" }));
  await waitFor(() =>
    expect(
      screen.queryByRole("button", { name: "Retry save" }),
    ).not.toBeInTheDocument(),
  );
  fireEvent.change(screen.getByRole("combobox", { name: "Script segment" }), {
    target: { value: "ending" },
  });
  await waitFor(() =>
    expect(
      screen.getByRole("combobox", { name: "Script segment" }),
    ).toHaveValue("ending"),
  );
});

it("warns about losing the script and versions, and deletes only after confirmation", async () => {
  renderSegmentSettings();
  await act(async () => {});
  await userEvent.click(
    screen.getByRole("button", { name: "Segment actions" }),
  );
  await userEvent.click(
    screen.getByRole("menuitem", { name: "Delete segment" }),
  );
  await waitFor(() =>
    expect(state.confirm).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Delete segment?",
        description:
          "Deleting Opening permanently removes its script and all script versions. This cannot be undone.",
        destructive: true,
      }),
    ),
  );
  expect(state.mutation).not.toHaveBeenCalled();
  expect(screen.getByRole("combobox", { name: "Script segment" })).toHaveValue(
    "opening",
  );
  state.confirm.mockResolvedValueOnce(true);
  await userEvent.click(
    screen.getByRole("button", { name: "Segment actions" }),
  );
  await userEvent.click(
    screen.getByRole("menuitem", { name: "Delete segment" }),
  );
  await waitFor(() =>
    expect(state.mutation).toHaveBeenCalledWith({
      projectId: "p",
      segmentId: "opening",
    }),
  );
  await waitFor(() =>
    expect(
      screen.getByRole("combobox", { name: "Script segment" }),
    ).toHaveValue("ending"),
  );
});

it("allows deleting the last segment and leaves the project ready to add another", async () => {
  state.confirm.mockResolvedValueOnce(true);
  state.mutation.mockImplementationOnce(async () => {
    state.segments = [];
  });
  renderSegmentSettings(true);
  await act(async () => {});
  await userEvent.click(
    screen.getByRole("button", { name: "Segment actions" }),
  );
  await userEvent.click(
    screen.getByRole("menuitem", { name: "Delete segment" }),
  );
  await waitFor(() =>
    expect(state.mutation).toHaveBeenCalledWith({
      projectId: "p",
      segmentId: "opening",
    }),
  );
  await waitFor(() =>
    expect(
      screen.queryByRole("button", { name: "Delete segment" }),
    ).not.toBeInTheDocument(),
  );
  expect(screen.getByRole("button", { name: "Add segment" })).toBeEnabled();
});

it("restores an archived segment from the editor and selects it", async () => {
  const archived = {
    _id: "archived",
    title: "Archived middle",
    durationSec: 12,
    versionCount: 3,
  };
  state.archivedSegments = [archived];
  state.mutation.mockImplementationOnce(async () => {
    state.archivedSegments = [];
    state.segments = [...state.segments, archived];
    return archived._id;
  });
  renderSegmentSettings();
  await act(async () => {});
  fireEvent.click(screen.getByText(/^Archived segments/));
  expect(screen.getByText("Archived middle")).toBeVisible();
  fireEvent.click(
    screen.getByRole("button", { name: "Restore Archived middle" }),
  );
  await waitFor(() =>
    expect(state.mutation).toHaveBeenCalledWith({
      projectId: "p",
      segmentId: "archived",
    }),
  );
  await waitFor(() =>
    expect(
      screen.getByRole("combobox", { name: "Script segment" }),
    ).toHaveValue("archived"),
  );
  expect(state.queries).toHaveBeenCalledWith("workspace:list", {
    projectId: "p",
    segmentId: "archived",
  });
  expect(screen.getByText("No archived segments")).toBeVisible();
});

it("unlocks reference imports and generation settings with credits while staging and music remain disabled", async () => {
  render(
    <WorkspaceContext.Provider
      value={{
        canWrite: false,
        canPrepareVideo: true,
        canGenerate: true,
        canCreate: true,
        canManage: true,
        workspaces: [],
        switchWorkspace: async () => {},
      }}
    >
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
      </MemoryRouter>
    </WorkspaceContext.Provider>,
  );
  await act(async () => {});
  expect(screen.getByRole("button", { name: "Import" })).toBeEnabled();
  expect(screen.getByLabelText("Import media")).toBeEnabled();
  expect(screen.getByLabelText("Import media")).toHaveAttribute(
    "accept",
    "image/*,video/*",
  );
  expect(screen.getByLabelText("Generation duration")).toBeEnabled();
  expect(screen.getByRole("button", { name: "Staging" })).toBeDisabled();
  expect(screen.getByLabelText("Import music")).toBeDisabled();
});
