import { type TimelineDocument } from "@cinakey/shared";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { getFunctionName } from "convex/server";
import { useState, type ReactNode } from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { timelineWithMedia } from "../../../../../packages/shared/test/timelineFixture";
import { EditPage } from "./EditPage";

const state = vi.hoisted(() => ({
  get: vi.fn(),
  save: vi.fn(),
  confirm: vi.fn(),
  document: null as unknown,
  canvases: [] as HTMLCanvasElement[],
  previewFailures: 0,
}));
vi.mock("@/lib/api/hooks", () => ({
  useQuery: (ref: Parameters<typeof getFunctionName>[0]) => {
    const name = getFunctionName(ref);
    if (name === "workspace:list") return { migrated: true };
    if (name === "projects:get")
      return { _id: "p", title: "Film", aspectRatio: "16:9", fps: 24 };
    if (name === "workspace:videos") return { videos: [], jobs: [] };
    if (name === "timelineVersions:getTip")
      return { _id: "v1", timelineFileId: "f1" };
    return [];
  },
  useMutation: () => vi.fn(),
  useAction: (ref: Parameters<typeof getFunctionName>[0]) =>
    getFunctionName(ref) === "timelineVersions:getContent"
      ? state.get
      : getFunctionName(ref) === "timelineVersions:save"
        ? state.save
        : state.get,
}));
vi.mock("@/components/use-confirm", () => ({
  useConfirm: () => state.confirm,
}));
vi.mock("@/features/edit/engine/PlaybackEngine", () => ({
  PlaybackEngine: class {
    constructor(canvas: HTMLCanvasElement) {
      if (state.previewFailures-- > 0) throw new Error("Preview unavailable");
      state.canvases.push(canvas);
    }
    subscribe() {}
    setDocument() {}
    dispose() {}
    seek() {}
  },
}));
vi.mock("@/features/studio/StudioWorkspace", () => ({
  StudioWorkspace: function StudioWorkspace({
    toolbar,
    viewer,
    timeline,
  }: {
    toolbar: ReactNode;
    viewer: ReactNode;
    timeline: ReactNode;
  }) {
    const [version, setVersion] = useState(0);
    return (
      <>
        {toolbar}
        <div key={version}>{viewer}</div>
        {timeline}
        <button onClick={() => setVersion((n) => n + 1)}>Remount viewer</button>
      </>
    );
  },
}));
vi.mock("@/features/edit/TimelineTracks", () => ({
  TimelineTracks: ({
    doc,
    onMoveClip,
  }: {
    doc: TimelineDocument;
    onMoveClip: (id: string, start: number) => void;
  }) => {
    const clip = doc.tracks.flatMap((t) => t.clips)[0]!;
    return (
      <button onClick={() => onMoveClip(clip.id, clip.startSec + 1)}>
        Move {clip.startSec}
      </button>
    );
  },
}));
vi.mock("@/features/edit/ExportDialog", () => ({ ExportDialog: () => null }));
vi.mock("@/features/edit/TimelineHistoryDialog", () => ({
  TimelineHistoryDialog: () => null,
}));
const mount = () =>
  render(
    <MemoryRouter initialEntries={["/projects/p/edit"]}>
      <Routes>
        <Route path="/projects/:projectId/edit" element={<EditPage />} />
      </Routes>
    </MemoryRouter>,
  );
const flush = async () => {
  await act(async () => {
    await Promise.resolve();
  });
};
beforeEach(() => {
  vi.useFakeTimers();
  const storage = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
    clear: () => storage.clear(),
  });
  state.canvases = [];
  state.previewFailures = 0;
  state.get.mockReset();
  state.save.mockReset();
  state.confirm.mockReset();
  state.document = timelineWithMedia({
    project: { id: "p", aspectRatio: "16:9", fps: 24 },
    clips: [
      {
        order: 0,
        durationSec: 5,
        assetId: "asset",
      },
    ],
  });
  state.get.mockResolvedValue({
    document: state.document,
    version: { _id: "v1" },
  });
  state.confirm.mockResolvedValue(true);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("safe editor persistence", () => {
  it("keeps edits made during a delayed save and serializes the next snapshot", async () => {
    let first!: (value: { versionId: string }) => void;
    state.save
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            first = resolve;
          }),
      )
      .mockResolvedValue({ versionId: "v3" });
    mount();
    await flush();
    fireEvent.click(screen.getByRole("button", { name: "Move 0" }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2100);
    });
    expect(state.save).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: "Move 1" }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2500);
    });
    expect(state.save).toHaveBeenCalledOnce();
    await act(async () => {
      first({ versionId: "v2" });
    });
    expect(screen.getByRole("button", { name: "Move 2" })).toBeInTheDocument();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2100);
    });
    expect(state.save).toHaveBeenCalledTimes(2);
    expect(state.save.mock.calls[1]![0].parentId).toBe("v2");
    expect(state.get).toHaveBeenCalledOnce();
  });
  it("retains and recovers a local draft after a failed save", async () => {
    state.save.mockRejectedValue(new Error("Offline"));
    const view = mount();
    await flush();
    fireEvent.click(screen.getByRole("button", { name: "Move 0" }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2100);
    });
    expect(
      screen.getByRole("button", { name: "Retry save" }),
    ).toBeInTheDocument();
    expect(localStorage.getItem("cinakey.timelineRecovery.p")).toContain(
      '"startSec":1',
    );
    view.unmount();
    mount();
    await flush();
    expect(state.confirm).toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Move 1" })).toBeInTheDocument();
  });
  it("does not replace a failed load with a writable empty timeline", async () => {
    state.get.mockRejectedValue(new Error("Could not read timeline"));
    mount();
    await flush();
    expect(
      screen.getByRole("button", { name: "Retry loading" }),
    ).toBeInTheDocument();
    expect(state.save).not.toHaveBeenCalled();
    expect(
      screen.queryByRole("button", { name: /Move/ }),
    ).not.toBeInTheDocument();
  });
  it("reattaches playback after the workspace replaces the viewer without reloading the edit", async () => {
    mount();
    await flush();
    const previous = state.canvases.at(-1);
    expect(previous).toBe(screen.getByLabelText("Timeline video preview"));
    fireEvent.click(screen.getByRole("button", { name: "Remount viewer" }));
    await flush();
    expect(state.canvases.at(-1)).not.toBe(previous);
    expect(state.canvases.at(-1)).toBe(
      screen.getByLabelText("Timeline video preview"),
    );
    expect(state.get).toHaveBeenCalledOnce();
    expect(screen.getByRole("button", { name: "Move 0" })).toBeInTheDocument();
  });
  it("recreates a failed playback engine when preview is retried", async () => {
    state.previewFailures = 1;
    mount();
    await flush();
    expect(
      screen.getByText("Preview unavailable: Preview unavailable"),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry preview" }));
    await flush();
    expect(state.canvases.at(-1)).toBe(
      screen.getByLabelText("Timeline video preview"),
    );
    expect(
      screen.queryByRole("button", { name: "Retry preview" }),
    ).not.toBeInTheDocument();
    expect(state.get).toHaveBeenCalledOnce();
  });
});
