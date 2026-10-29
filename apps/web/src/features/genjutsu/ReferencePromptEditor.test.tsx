import { useRef, useState } from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import type { ReferenceBinding } from "@dirrio/shared";
import {
  ReferencePromptEditor,
  type ReferencePromptHandle,
} from "./ReferencePromptEditor";
afterEach(cleanup);
const assets = [
  { _id: "one", name: "Actor.png", type: "image" },
  { _id: "two", name: "Background.png", type: "image" },
];
function Harness({ initial = "" }: { initial?: string }) {
  const [text, setText] = useState(initial);
  const [bindings, setBindings] = useState<ReferenceBinding[]>([]);
  const editor = useRef<ReferencePromptHandle>(null);
  return (
    <>
      <ReferencePromptEditor
        ref={editor}
        projectId="scope"
        value={text}
        onChange={setText}
        assets={assets}
        urls={[]}
        bindings={bindings}
        disabled={false}
        onBind={async (alias, assetId) =>
          setBindings((old) => [
            ...old.filter((entry) => entry.alias !== alias),
            { alias, assetId },
          ])
        }
      />
      <button onClick={() => editor.current?.insertAsset("one")}>
        Click library image
      </button>
      <output aria-label="Bound images">{JSON.stringify(bindings)}</output>
    </>
  );
}
it("opens @ suggestions, filters them, inserts a keyboard-selected image and keeps plain text editable", async () => {
  render(<Harness />);
  const input = screen.getByLabelText("Describe the change");
  fireEvent.change(input, {
    target: { value: "Use @back", selectionStart: 9 },
  });
  expect(
    screen.getByRole("dialog", { name: "Reference picker" }),
  ).toBeInTheDocument();
  expect(screen.getAllByRole("option")).toHaveLength(1);
  await act(async () => {
    fireEvent.keyDown(input, { key: "Enter" });
  });
  expect(input).toHaveValue("Use @background_png ");
  expect(screen.getByLabelText("Bound images")).toHaveTextContent(
    '"assetId":"two"',
  );
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});
it("replaces every occurrence of a numbered alias, supports undo, and renames the entire prompt", async () => {
  render(<Harness initial="Use @image_1, then use @image_1 again." />);
  fireEvent.click(
    screen.getByRole("button", { name: /@image_1.*Link missing image/ }),
  );
  await act(async () => {
    fireEvent.click(
      screen.getByRole("option", { name: "Link Actor.png (image)" }),
    );
  });
  expect(screen.getByLabelText("Describe the change")).toHaveValue(
    "Use @image_1, then use @image_1 again.",
  );
  fireEvent.click(screen.getByRole("button", { name: /@image_1.*Actor.png/ }));
  await act(async () => {
    fireEvent.click(
      screen.getByRole("option", { name: "Link Background.png (image)" }),
    );
  });
  expect(screen.getByLabelText("Bound images")).toHaveTextContent(
    '"assetId":"two"',
  );
  await act(async () => {
    fireEvent.click(
      screen.getByRole("button", { name: "Undo reference replacement" }),
    );
  });
  expect(screen.getByLabelText("Bound images")).toHaveTextContent(
    '"assetId":"one"',
  );
  fireEvent.click(screen.getByRole("button", { name: /@image_1.*Actor.png/ }));
  fireEvent.change(screen.getByLabelText("Reference name"), {
    target: { value: "hero" },
  });
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Rename everywhere" }));
  });
  expect(screen.getByLabelText("Describe the change")).toHaveValue(
    "Use @hero, then use @hero again.",
  );
});
it("inserts library images at the prompt caret and accepts internal image drops", async () => {
  render(<Harness initial="Replace this." />);
  const input = screen.getByLabelText(
    "Describe the change",
  ) as HTMLTextAreaElement;
  input.setSelectionRange(8, 12);
  fireEvent.select(input);
  await act(async () => {
    fireEvent.click(
      screen.getByRole("button", { name: "Click library image" }),
    );
  });
  expect(input.value).toContain("@actor_png");
  await act(async () => {
    fireEvent.drop(input.parentElement!, {
      dataTransfer: { getData: () => JSON.stringify({ assetId: "two" }) },
    });
  });
  expect(input.value).toContain("@background_png");
});
it("dismisses suggestions with Escape without consuming unrelated typing", () => {
  render(<Harness />);
  const input = screen.getByLabelText("Describe the change");
  fireEvent.change(input, { target: { value: "@", selectionStart: 1 } });
  expect(
    screen.getByRole("listbox", { name: "Image references" }),
  ).toBeInTheDocument();
  fireEvent.keyDown(input, { key: "Escape" });
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});

it("moves through suggestions with arrow keys and inserts the active image with Tab", async () => {
  render(<Harness />);
  const input = screen.getByLabelText("Describe the change");
  fireEvent.change(input, { target: { value: "Use @", selectionStart: 5 } });
  fireEvent.keyDown(input, { key: "ArrowDown" });
  expect(
    screen.getByRole("option", { name: "Link Background.png (image)" }),
  ).toHaveAttribute("aria-selected", "true");
  await act(async () => {
    fireEvent.keyDown(input, { key: "Tab" });
  });
  expect(input).toHaveValue("Use @background_png ");
});

it("converts a mismatched video alias to an unused image alias and rewrites all occurrences", async () => {
  render(
    <Harness initial="Use @video_1 twice: @video_1, plus @image_1 and @image_2." />,
  );
  fireEvent.click(
    screen.getByRole("button", { name: /@video_1.*Link missing image/ }),
  );
  await act(async () => {
    fireEvent.click(
      screen.getByRole("option", { name: "Link Actor.png (image)" }),
    );
  });
  expect(screen.getByLabelText("Describe the change")).toHaveValue(
    "Use @image_3 twice: @image_3, plus @image_1 and @image_2.",
  );
  expect(screen.getByLabelText("Bound images")).toHaveTextContent(
    '"alias":"image_3"',
  );
  expect(screen.getByLabelText("Bound images")).not.toHaveTextContent(
    '"alias":"video_1"',
  );
});
it("recognizes the selected source video without sending it through the image picker", () => {
  render(
    <ReferencePromptEditor
      projectId="scope"
      sourceAssetId="source"
      value="Follow @video_1 and @video_1 again."
      onChange={() => {}}
      assets={[...assets, { _id: "source", name: "Source.mp4", type: "video" }]}
      urls={[]}
      bindings={[]}
      disabled={false}
      onBind={async () => {
        throw new Error("Source must not bind as an image");
      }}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: /@video_1.*Source.mp4/ }));
  expect(
    screen.queryByRole("dialog", { name: "Reference picker" }),
  ).not.toBeInTheDocument();
  expect(screen.getByRole("status")).toHaveTextContent("selected source video");
  expect(screen.queryByText("Link missing image")).not.toBeInTheDocument();
});

it("converts every occurrence when an image is selected for a typed video alias", async () => {
  render(<Harness />);
  const input = screen.getByLabelText("Describe the change");
  const value = "Keep @video_1 and @image_1, then use @video_1";
  fireEvent.change(input, { target: { value, selectionStart: value.length } });
  await act(async () => {
    fireEvent.click(
      screen.getByRole("option", { name: "Link Actor.png (image)" }),
    );
  });
  expect(input).toHaveValue("Keep @image_2 and @image_1, then use @image_2 ");
  expect(screen.getByLabelText("Bound images")).toHaveTextContent(
    '"alias":"image_2"',
  );
});
