import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { getFunctionName } from "convex/server";
import { createEmptyTimeline } from "@dirrio/shared";
import { ExportDialog } from "./ExportDialog";
const mocks = vi.hoisted(() => ({
  canWrite: true,
  get: vi.fn(),
  begin: vi.fn(),
  record: vi.fn(),
  render: vi.fn(),
  download: vi.fn(),
  upload: vi.fn(),
  invalidate: vi.fn(),
}));
vi.mock("@/features/workspaces/workspace-context", () => ({
  useWorkspace: () => ({ canWrite: mocks.canWrite }),
}));
vi.mock("@/lib/api/context", () => ({
  useClient: () => ({
    token: "fixture",
    baseUrl: "http://localhost",
    invalidate: mocks.invalidate,
  }),
}));
vi.mock("@/lib/api/hooks", () => ({
  useMutation: () => mocks.record,
  useAction: (ref: Parameters<typeof getFunctionName>[0]) =>
    getFunctionName(ref) === "timelineVersions:getContent"
      ? mocks.get
      : mocks.begin,
}));
vi.mock("./export/exportTimeline", () => ({
  webCodecsExportSupported: async () => true,
  exportCapsOk: () => null,
  exportTimelineMp4: mocks.render,
  downloadBlob: mocks.download,
}));
vi.mock("./publicationUpload", () => ({ uploadPublication: mocks.upload }));
const fixtureDocument = createEmptyTimeline({
  id: "project",
  aspectRatio: "16:9",
  fps: 24,
});
fixtureDocument.durationSec = 1;
const doc = () => structuredClone(fixtureDocument);
const mount = () =>
  render(
    <ExportDialog
      open
      onOpenChange={vi.fn()}
      doc={doc()}
      urls={{}}
      projectTitle="Film"
      projectId={"project" as never}
    />,
  );
beforeEach(() => {
  vi.clearAllMocks();
  mocks.canWrite = true;
  mocks.get.mockResolvedValue({ document: doc(), version: { _id: "saved" } });
  mocks.begin.mockResolvedValue({ publicationId: "publication" });
  mocks.render.mockResolvedValue(new Blob(["render"]));
  mocks.upload.mockResolvedValue(undefined);
});
afterEach(cleanup);
it("downloads before uploading the frozen saved snapshot", async () => {
  mount();
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Export" })).toBeEnabled(),
  );
  fireEvent.click(screen.getByRole("button", { name: "Export" }));
  await waitFor(() =>
    expect(screen.getByRole("status")).toHaveTextContent("Video stored"),
  );
  expect(mocks.begin).toHaveBeenCalledWith(
    expect.objectContaining({ versionId: "saved" }),
  );
  expect(mocks.render).toHaveBeenCalledWith(
    expect.objectContaining({ doc: doc() }),
  );
  expect(mocks.download.mock.invocationCallOrder[0]).toBeLessThan(
    mocks.upload.mock.invocationCallOrder[0]!,
  );
});
it("retains the downloaded render and retries the same publication without rendering again", async () => {
  mocks.upload
    .mockRejectedValueOnce(new Error("Offline"))
    .mockResolvedValueOnce(undefined);
  mount();
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Export" })).toBeEnabled(),
  );
  fireEvent.click(screen.getByRole("button", { name: "Export" }));
  fireEvent.click(await screen.findByRole("button", { name: "Retry upload" }));
  await waitFor(() =>
    expect(screen.getByRole("status")).toHaveTextContent("Video stored"),
  );
  expect(mocks.upload).toHaveBeenCalledTimes(2);
  expect(mocks.upload.mock.calls[1]![1]).toBe("publication");
  expect(mocks.render).toHaveBeenCalledOnce();
});
it("requires the current edit to match a saved version before publication", async () => {
  mocks.get.mockResolvedValue({
    document: { ...doc(), durationSec: 2 },
    version: { _id: "different" },
  });
  mount();
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Export" })).toBeEnabled(),
  );
  fireEvent.click(screen.getByRole("button", { name: "Export" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Wait for this edit to save",
  );
  expect(mocks.begin).not.toHaveBeenCalled();
  expect(mocks.render).not.toHaveBeenCalled();
});
it("allows a local download while subscription access prevents new stored uploads", async () => {
  mocks.canWrite = false;
  mount();
  await screen.findByRole("button", { name: "Export" });
  const store = screen.getByRole("checkbox");
  expect(store).toBeDisabled();
  expect(store).not.toBeChecked();
  fireEvent.click(screen.getByRole("button", { name: "Export" }));
  await waitFor(() => expect(mocks.download).toHaveBeenCalledOnce());
  expect(mocks.begin).not.toHaveBeenCalled();
  expect(mocks.upload).not.toHaveBeenCalled();
});

it("shows render percentage and keeps cancellation wired to the exporter", async () => {
  let signal: AbortSignal | undefined;
  mocks.render.mockImplementation(({ onProgress, signal: currentSignal }) => {
    signal = currentSignal;
    onProgress({
      phase: "video",
      frame: 64,
      totalFrames: 100,
      message: "Rendering frames…",
    });
    return new Promise(() => {});
  });
  mount();
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Export" })).toBeEnabled(),
  );
  fireEvent.click(screen.getByRole("button", { name: "Export" }));
  expect(await screen.findByText("64%")).toBeInTheDocument();
  expect(
    screen.getByRole("progressbar", { name: "Rendering progress" }),
  ).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Cancel export" }));
  expect(signal?.aborted).toBe(true);
});
