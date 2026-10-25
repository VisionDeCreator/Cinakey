import { createEmptyTimeline } from "@cinakey/shared";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { TimelineTracks } from "./TimelineTracks";
import { MEDIA_DRAG_TYPE } from "./mediaDrag";
afterEach(cleanup);
it("accepts project assets and local files at a frame-aligned track position", () => {
  const doc = createEmptyTimeline({ id: "p", fps: 24, aspectRatio: "16:9" });
  const drop = vi.fn();
  const { container } = render(
    <TimelineTracks
      doc={doc}
      playheadSec={0}
      pxPerSec={60}
      selectedClipId={null}
      trimMode="ripple"
      onSelectClip={vi.fn()}
      onSeek={vi.fn()}
      onMoveClip={vi.fn()}
      onTrim={vi.fn()}
      onRoll={vi.fn()}
      onZoom={vi.fn()}
      onDropMedia={drop}
    />,
  );
  const lane = container.querySelector(
    `[data-track-id="${doc.tracks[0]!.id}"]`,
  )!;
  const data = {
    types: [MEDIA_DRAG_TYPE],
    files: [],
    getData: () => JSON.stringify({ assetId: "video" }),
    dropEffect: "none",
  };
  const drag = (type: string, x: number, transfer: unknown) => {
    const event = new MouseEvent(type, {
      bubbles: true,
      cancelable: true,
      clientX: x,
    });
    Object.defineProperty(event, "dataTransfer", { value: transfer });
    fireEvent(lane, event);
  };
  drag("dragover", 120, data);
  expect(screen.getByText("Drop at 2.00s")).toBeInTheDocument();
  drag("drop", 120, data);
  expect(drop).toHaveBeenCalledWith("video", [], 2, doc.tracks[0]!.id);
  const file = new File(["video"], "camera.mp4", { type: "video/mp4" });
  drag("drop", 60, {
    ...data,
    types: ["Files"],
    files: [file],
    getData: () => "",
  });
  expect(drop).toHaveBeenLastCalledWith(null, [file], 1, doc.tracks[0]!.id);
});

it("seeks from the ruler without clearing the selected clip", () => {
  const doc = createEmptyTimeline({ id: "p", fps: 24, aspectRatio: "16:9" });
  const select = vi.fn(),
    seek = vi.fn();
  render(
    <TimelineTracks
      doc={doc}
      playheadSec={0}
      pxPerSec={60}
      selectedClipId="clip"
      trimMode="ripple"
      onSelectClip={select}
      onSeek={seek}
      onMoveClip={vi.fn()}
      onTrim={vi.fn()}
      onRoll={vi.fn()}
      onZoom={vi.fn()}
    />,
  );
  fireEvent.pointerDown(screen.getByLabelText("Timeline time ruler"), {
    clientX: 90,
  });
  expect(seek).toHaveBeenCalled();
  expect(select).not.toHaveBeenCalled();
});
