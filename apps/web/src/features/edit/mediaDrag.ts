/** Only project asset identifiers cross the drag boundary; media is resolved locally. */
export const MEDIA_DRAG_TYPE = "application/x-dirrio-asset";
export function readDraggedAsset(
  data: Pick<DataTransfer, "getData">,
): string | null {
  try {
    const value: unknown = JSON.parse(data.getData(MEDIA_DRAG_TYPE));
    return typeof value === "object" &&
      value !== null &&
      "assetId" in value &&
      typeof value.assetId === "string" &&
      value.assetId.length > 0
      ? value.assetId
      : null;
  } catch {
    return null;
  }
}
export const MEDIA_POINTER_EVENT = "dirrio:media-pointer";
export type MediaPointerDetail = {
  assetId: string;
  x: number;
  y: number;
  phase: "move" | "drop" | "cancel";
};
/** Internal media dragging uses pointer events, including touch and embedded WebViews. */
export function beginMediaPointerDrag(
  event: import("react").PointerEvent,
  assetId: string,
) {
  if (event.button !== 0 || !event.isPrimary) return;
  const { clientX: x, clientY: y, pointerId } = event;
  let moved = false;
  const send = (phase: MediaPointerDetail["phase"], e: PointerEvent) =>
    window.dispatchEvent(
      new CustomEvent<MediaPointerDetail>(MEDIA_POINTER_EVENT, {
        detail: { assetId, x: e.clientX, y: e.clientY, phase },
      }),
    );
  const move = (e: PointerEvent) => {
    if (e.pointerId !== pointerId) return;
    moved ||= Math.hypot(e.clientX - x, e.clientY - y) > 8;
    if (moved) {
      e.preventDefault();
      send("move", e);
    }
  };
  const end = (e: PointerEvent) => {
    if (e.pointerId !== pointerId) return;
    if (moved) {
      send(e.type === "pointercancel" ? "cancel" : "drop", e);
      if (e.type !== "pointercancel") {
        const suppress = (click: Event) => {
          click.preventDefault();
          click.stopPropagation();
        };
        window.addEventListener("click", suppress, {
          capture: true,
          once: true,
        });
        setTimeout(
          () => window.removeEventListener("click", suppress, true),
          0,
        );
      }
    }
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", end);
    window.removeEventListener("pointercancel", end);
  };
  window.addEventListener("pointermove", move, { passive: false });
  window.addEventListener("pointerup", end);
  window.addEventListener("pointercancel", end);
}
