import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { getFunctionName } from "convex/server";
import { VideoTransformPanel } from "./VideoTransformPanel";
const mocks = vi.hoisted(() => ({
  analyze: vi.fn(),
  generate: vi.fn(),
  sample: vi.fn(),
  bind: vi.fn(),
  bindings: [] as { alias: string; assetId: string }[],
}));
vi.mock("@/lib/api/hooks", () => ({
  useAction: (ref: Parameters<typeof getFunctionName>[0]) =>
    getFunctionName(ref) === "transforms:analyze"
      ? mocks.analyze
      : mocks.generate,
  useQuery: (ref: Parameters<typeof getFunctionName>[0]) =>
    getFunctionName(ref) === "references:list"
      ? mocks.bindings
      : { usdMicros: 1_000_000 },
  useMutation: () => mocks.bind,
}));
vi.mock("./sampleVideoFrames", () => ({ sampleVideoFrames: mocks.sample }));
const analysis = {
  subjects: "Actor",
  action: "Walks",
  camera: "Tracks left",
  setting: "Street",
  uncertainties: ["Hands obscured"],
};
const props = {
  projectId: "project",
  sourceId: "source",
  sourceUrl: "https://fixture.test/source.mp4",
  assets: [
    { _id: "source", name: "Walk", type: "video", durationSec: 5.056 },
    { _id: "actor", name: "Replacement actor", type: "image" },
  ],
  running: false,
  remaining: 10_000_000,
  onStarted: vi.fn(),
};
beforeEach(() => {
  mocks.bindings = [{ alias: "replacement_actor", assetId: "actor" }];
  mocks.bind.mockImplementation(
    async ({ alias, assetId }: { alias: string; assetId: string }) => {
      mocks.bindings = [
        ...mocks.bindings.filter((item) => item.alias !== alias),
        { alias, assetId },
      ];
    },
  );
  mocks.sample.mockResolvedValue(
    [0, 1, 2].map((timeSec) => ({
      timeSec,
      dataUrl: "data:image/jpeg;base64,AA==",
    })),
  );
  mocks.analyze.mockResolvedValue({ analysis, usdMicros: 20_000, mock: false });
  mocks.generate.mockResolvedValue({ jobId: "job" });
});
afterEach(() => {
  cleanup();
  localStorage.clear?.();
  vi.resetAllMocks();
});
function prompt(value = "Make @replacement_actor wear red in a snowy village") {
  fireEvent.change(screen.getByLabelText("Describe the change"), {
    target: { value },
  });
}
async function generate() {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: /^Generate ·/ }));
  });
}
it("automatically analyzes then generates from a prompt with one click using a reference and no selected categories", async () => {
  render(<VideoTransformPanel {...props} />);
  expect(
    screen.queryByRole("button", { name: /Analyze source/ }),
  ).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: /^Generate ·/ })).toBeDisabled();
  prompt();
  expect(
    screen.getByRole("button", { name: "Generate · up to $1.030432" }),
  ).toBeEnabled();
  await generate();
  expect(mocks.sample).toHaveBeenCalledOnce();
  expect(mocks.analyze.mock.invocationCallOrder[0]).toBeLessThan(
    mocks.generate.mock.invocationCallOrder[0]!,
  );
  expect(mocks.generate.mock.calls[0]![0]).toMatchObject({
    referenceAssetIds: ["actor"],
    plan: {
      targets: [],
      instruction: "Make @replacement_actor wear red in a snowy village",
      analysis,
      analysisModel: "deepseek-flash",
      sampledFrameTimes: [0, 1, 2],
    },
  });
  expect(
    screen.getByRole("button", { name: "Transformation queued" }),
  ).toBeDisabled();
});
it("reuses analysis and the same submission ID after a lost render acknowledgement", async () => {
  mocks.generate
    .mockRejectedValueOnce(new Error("Connection lost"))
    .mockResolvedValueOnce({ jobId: "job" });
  render(<VideoTransformPanel {...props} />);
  prompt();
  fireEvent.change(screen.getByLabelText("Describe the change"), {
    target: { value: "Replace the actor with @replacement_actor" },
  });
  mocks.bindings = [{ alias: "replacement_actor", assetId: "actor" }];
  fireEvent.change(screen.getByLabelText("Describe the change"), {
    target: { value: "Replace the actor with @replacement_actor." },
  });
  await generate();
  expect(screen.getByRole("alert")).toHaveTextContent("Connection lost");
  expect(
    screen.getByRole("button", { name: "Generate · $1.00" }),
  ).toBeEnabled();
  await generate();
  expect(mocks.analyze).toHaveBeenCalledOnce();
  expect(mocks.generate.mock.calls[0]![0].requestId).toBe(
    mocks.generate.mock.calls[1]![0].requestId,
  );
  expect(mocks.generate.mock.calls[0]![0].referenceAssetIds).toEqual(["actor"]);
});
it("stops before rendering when analysis fails and offers a single-button retry", async () => {
  mocks.analyze.mockRejectedValueOnce(new Error("Analysis failed"));
  render(<VideoTransformPanel {...props} />);
  prompt();
  await generate();
  expect(mocks.generate).not.toHaveBeenCalled();
  expect(screen.getByRole("alert")).toHaveTextContent("Analysis failed");
  await generate();
  expect(mocks.analyze).toHaveBeenCalledTimes(2);
  expect(mocks.generate).toHaveBeenCalledOnce();
});
it("shows analysis progress, blocks repeated clicks, and locks settings until submission finishes", async () => {
  let finish!: (value: {
    analysis: typeof analysis;
    usdMicros: number;
    mock: boolean;
  }) => void;
  mocks.analyze.mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  render(<VideoTransformPanel {...props} />);
  prompt();
  await generate();
  expect(
    screen.getByRole("button", { name: "Analyzing video…" }),
  ).toBeDisabled();
  expect(screen.getByLabelText("Describe the change")).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Analyzing video…" }));
  expect(mocks.analyze).toHaveBeenCalledOnce();
  expect(mocks.generate).not.toHaveBeenCalled();
  await act(async () => {
    finish({ analysis, usdMicros: 20_000, mock: false });
  });
  expect(mocks.generate).toHaveBeenCalledOnce();
});
it("reanalyzes changed prompts but reuses analysis for optional target changes", async () => {
  render(<VideoTransformPanel {...props} />);
  prompt();
  await generate();
  fireEvent.click(screen.getByLabelText("Characters"));
  fireEvent.click(screen.getByLabelText("Environment"));
  await generate();
  expect(mocks.analyze).toHaveBeenCalledOnce();
  expect(mocks.generate.mock.calls[1]![0].plan.targets).toEqual([
    "recast",
    "environment",
  ]);
  prompt("A different transformation using @replacement_actor");
  await generate();
  expect(mocks.analyze).toHaveBeenCalledTimes(2);
});
it("does not submit a render after the source panel is unmounted during analysis", async () => {
  let finish!: (value: {
    analysis: typeof analysis;
    usdMicros: number;
    mock: boolean;
  }) => void;
  mocks.analyze.mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  const { unmount } = render(<VideoTransformPanel {...props} />);
  prompt();
  await generate();
  unmount();
  await act(async () => {
    finish({ analysis, usdMicros: 20_000, mock: false });
  });
  expect(mocks.generate).not.toHaveBeenCalled();
});
it("blocks generation while uploads are pending or the combined estimate exceeds the spend limit", () => {
  const { rerender } = render(<VideoTransformPanel {...props} uploading />);
  prompt();
  expect(screen.getByRole("button", { name: /^Generate ·/ })).toBeDisabled();
  rerender(<VideoTransformPanel {...props} remaining={24} />);
  expect(screen.getByRole("button", { name: /^Generate ·/ })).toBeDisabled();
  expect(mocks.analyze).not.toHaveBeenCalled();
});

it("blocks unresolved image mentions before analysis or generation", () => {
  render(<VideoTransformPanel {...props} />);
  prompt("Use @missing_image everywhere");
  expect(screen.getByRole("button", { name: /^Generate ·/ })).toBeDisabled();
  expect(
    screen
      .getAllByRole("alert")
      .some((el) =>
        el.textContent?.includes("Link missing image @missing_image"),
      ),
  ).toBe(true);
  expect(mocks.analyze).not.toHaveBeenCalled();
  expect(mocks.generate).not.toHaveBeenCalled();
});

it("requires a Remix reference before analysis and blocks overlong source footage", () => {
  const { rerender } = render(<VideoTransformPanel {...props} />);
  prompt("Change the outfit without an image");
  expect(screen.getByRole("button", { name: /^Generate ·/ })).toBeDisabled();
  expect(
    screen.getByText("Add at least one image reference for Remix Lite."),
  ).toBeInTheDocument();
  prompt();
  rerender(
    <VideoTransformPanel
      {...props}
      assets={props.assets.map((a) =>
        a.type === "video" ? { ...a, durationSec: 16 } : a,
      )}
    />,
  );
  expect(screen.getByRole("button", { name: /^Generate ·/ })).toBeDisabled();
  expect(mocks.analyze).not.toHaveBeenCalled();
});
