import { act, render, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { TimelineClip } from "@dirrio/shared";
import { ClipMedia } from "./ClipMedia";
import type { EditorMedia, MediaAnalysis } from "./EditorMedia";
afterEach(() => vi.unstubAllGlobals());
it("defers work until visible and displays thumbnails from the trimmed source window", async () => {
  let visible!: (entries: { isIntersecting: boolean }[]) => void;
  const disconnect = vi.fn();
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      constructor(callback: typeof visible) {
        visible = callback;
      }
      observe() {}
      disconnect = disconnect;
    },
  );
  const snapshot: MediaAnalysis = {
    status: "ready",
    duration: 10,
    peaks: [],
    thumbnails: [0, 2, 4, 6, 8].map((time) => ({ time, url: `frame-${time}` })),
  };
  const request = vi.fn();
  const media = {
    get: () => snapshot,
    subscribe: () => () => {},
    request,
  } as unknown as EditorMedia;
  const clip: TimelineClip = {
    id: "c",
    startSec: 0,
    inSec: 4,
    outSec: 8,
    durationSec: 2,
    speed: 2,
    source: { type: "asset", assetId: "a" },
  };
  const { container, unmount } = render(
    <ClipMedia
      clip={clip}
      urls={{ a: { url: "fixture", type: "video" } }}
      media={media}
      width={128}
    />,
  );
  expect(request).not.toHaveBeenCalled();
  act(() => visible([{ isIntersecting: true }]));
  await waitFor(() =>
    expect(request).toHaveBeenCalledWith("a", "fixture", "video", false),
  );
  expect(
    [...container.querySelectorAll("img")].map((img) =>
      img.getAttribute("src"),
    ),
  ).toEqual(["frame-4", "frame-6"]);
  unmount();
  expect(disconnect).toHaveBeenCalled();
  expect(fetch).not.toHaveBeenCalled();
});
