import { afterEach, expect, it, vi } from "vitest";
import type { PointerEvent as ReactPointerEvent } from "react";
import {
  beginMediaPointerDrag,
  MEDIA_POINTER_EVENT,
  readDraggedAsset,
  type MediaPointerDetail,
} from "./mediaDrag";
const pointer = (type: string, x: number, y: number) => {
  const event = new MouseEvent(type, {
    clientX: x,
    clientY: y,
    bubbles: true,
    cancelable: true,
  });
  Object.defineProperty(event, "pointerId", { value: 1 });
  window.dispatchEvent(event);
};
afterEach(() => vi.restoreAllMocks());
it("preserves clicks below the drag threshold and emits a pointer drop above it", () => {
  const receive = vi.fn();
  window.addEventListener(MEDIA_POINTER_EVENT, receive);
  const start = {
    button: 0,
    isPrimary: true,
    pointerId: 1,
    clientX: 10,
    clientY: 10,
  } as ReactPointerEvent;
  beginMediaPointerDrag(start, "asset");
  pointer("pointermove", 12, 10);
  pointer("pointerup", 12, 10);
  expect(receive).not.toHaveBeenCalled();
  beginMediaPointerDrag(start, "asset");
  pointer("pointermove", 100, 80);
  pointer("pointerup", 100, 80);
  expect(
    receive.mock.calls.map(
      ([event]) => (event as CustomEvent<MediaPointerDetail>).detail,
    ),
  ).toEqual([
    { assetId: "asset", x: 100, y: 80, phase: "move" },
    { assetId: "asset", x: 100, y: 80, phase: "drop" },
  ]);
  window.removeEventListener(MEDIA_POINTER_EVENT, receive);
});
it("cancels a drag when the browser cancels its pointer stream", () => {
  const receive = vi.fn();
  window.addEventListener(MEDIA_POINTER_EVENT, receive);
  beginMediaPointerDrag(
    {
      button: 0,
      isPrimary: true,
      pointerId: 1,
      clientX: 0,
      clientY: 0,
    } as ReactPointerEvent,
    "asset",
  );
  pointer("pointermove", 30, 40);
  pointer("pointercancel", 30, 40);
  expect(
    (receive.mock.calls.at(-1)![0] as CustomEvent<MediaPointerDetail>).detail
      .phase,
  ).toBe("cancel");
  pointer("pointerup", 30, 40);
  expect(receive).toHaveBeenCalledTimes(2);
  window.removeEventListener(MEDIA_POINTER_EVENT, receive);
});
it("rejects malformed drag payloads", () => {
  for (const raw of [
    "",
    "not-json",
    "null",
    '{"assetId":12}',
    '{"assetId":""}',
  ])
    expect(readDraggedAsset({ getData: () => raw })).toBeNull();
});
