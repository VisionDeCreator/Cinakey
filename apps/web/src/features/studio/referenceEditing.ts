/** Shared viewport placement for typed and clicked reference menus. */
export function referencePickerPosition(left: number, top: number) {
  return {
    left: Math.max(8, Math.min(left, window.innerWidth - 330)),
    top: Math.max(8, Math.min(top, window.innerHeight - 350)),
  };
}

/** Measure the caret using the textarea's own font, wrapping and scroll offsets. */
export function caretPosition(node: HTMLTextAreaElement, caret: number) {
  const mirror = document.createElement("div");
  const style = getComputedStyle(node);
  for (const name of [
    "font",
    "line-height",
    "letter-spacing",
    "padding",
    "border",
    "box-sizing",
    "word-break",
    "overflow-wrap",
    "tab-size",
  ])
    mirror.style.setProperty(name, style.getPropertyValue(name));
  Object.assign(mirror.style, {
    position: "fixed",
    visibility: "hidden",
    width: `${node.clientWidth}px`,
    whiteSpace: "pre-wrap",
    overflowWrap: "break-word",
    top: "0",
    left: "0",
  });
  mirror.textContent = node.value.slice(0, caret);
  const marker = document.createElement("span");
  marker.textContent = "\u200b";
  mirror.append(marker);
  document.body.append(mirror);
  const point = marker.getBoundingClientRect(),
    box = node.getBoundingClientRect();
  const position = referencePickerPosition(
    box.left + point.left - node.scrollLeft,
    box.top + point.top - node.scrollTop + (parseFloat(style.lineHeight) || 22),
  );
  mirror.remove();
  return position;
}
