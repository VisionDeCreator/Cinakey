import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { getFunctionName } from "convex/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StudioScript } from "./StudioScript";
const state = vi.hoisted(() => ({
  canWrite: true,
  text: "@image_1 meets @image_1. @james walks.",
  save: vi.fn(),
  bind: vi.fn(),
  dirty: vi.fn(),
  upload: vi.fn(),
  replace: vi.fn(),
  undoConversion: vi.fn(),
}));
vi.mock("@/features/workspaces/workspace-context", () => ({
  useWorkspace: () => ({ canWrite: state.canWrite }),
  useDraftScope: () => "",
}));
vi.mock("@/lib/api/hooks", () => ({
  useQuery: (ref: Parameters<typeof getFunctionName>[0]) => {
    switch (getFunctionName(ref)) {
      case "workspace:list":
        return { migrated: true, script: { _id: "tip" }, scripts: [] };
      case "assets:list":
        return [
          { _id: "asset-james", name: "James", type: "image" },
          { _id: "asset-motion", name: "Motion", type: "video" },
        ];
      default:
        return [];
    }
  },
  useAction: () => async () => ({ id: "tip", text: state.text }),
  useMutation: (ref: Parameters<typeof getFunctionName>[0]) =>
    getFunctionName(ref) === "workspace:saveScript"
      ? state.save
      : getFunctionName(ref) === "references:replace"
        ? state.replace
        : getFunctionName(ref) === "references:undoReplacement"
          ? state.undoConversion
          : state.bind,
}));
vi.mock("@/features/assets/useAssetUpload", () => ({
  useAssetUpload: () => ({ uploadFiles: state.upload, uploads: [] }),
}));
function mount() {
  const saveRef = { current: null as (() => Promise<boolean>) | null };
  return {
    ...render(
      <StudioScript
        projectId="project"
        onDirty={state.dirty}
        saveRef={saveRef}
      />,
    ),
    saveRef,
  };
}
beforeEach(() => {
  state.canWrite = true;
  state.text = "@image_1 meets @image_1. @james walks.";
  state.save.mockReset().mockResolvedValue("saved");
  state.bind
    .mockReset()
    .mockResolvedValue({ alias: "image_1", assetId: "asset-james" });
  state.dirty.mockReset();
  state.upload.mockReset();
  state.replace.mockReset();
  state.undoConversion.mockReset();
  const storage = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
describe("connected script references and safe autosave", () => {
  it("binds all occurrences of an alias without rewriting unrelated script text", async () => {
    mount();
    await act(async () => {});
    fireEvent.click(
      screen.getByRole("button", { name: /@image_1.*Link asset/ }),
    );
    fireEvent.click(screen.getByRole("option", { name: /Link James/ }));
    await act(async () => {});
    expect(state.bind).toHaveBeenCalledWith({
      projectId: "project",
      alias: "image_1",
      assetId: "asset-james",
    });
    expect(screen.getByRole("textbox", { name: "Script" })).toHaveValue(
      state.text,
    );
  });
  it("completes a partial named mention even when the same reference already occurs earlier", async () => {
    mount();
    await act(async () => {});
    const input = screen.getByRole("textbox", {
      name: "Script",
    }) as HTMLTextAreaElement;
    fireEvent.change(input, {
      target: { value: "@james walks. @ja", selectionStart: 17 },
    });
    fireEvent.click(screen.getByRole("option", { name: /Link James/ }));
    await act(async () => {});
    expect(state.bind).toHaveBeenCalledWith({
      projectId: "project",
      alias: "james",
      assetId: "asset-james",
    });
    expect(input.value).toBe("@james walks. @james ");
  });
  it("serializes saves and retains edits typed while an older snapshot is saving", async () => {
    vi.useFakeTimers();
    let finish!: (result: string) => void;
    state.save
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      )
      .mockResolvedValue("second");
    const { saveRef } = mount();
    await act(async () => {});
    const input = screen.getByRole("textbox", { name: "Script" });
    fireEvent.change(input, { target: { value: "First edit" } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1100);
    });
    fireEvent.change(input, { target: { value: "Second edit" } });
    expect(state.save).toHaveBeenCalledTimes(1);
    await act(async () => {
      finish("first");
    });
    expect(state.save).toHaveBeenCalledTimes(2);
    expect(state.save.mock.calls[1]![0].text).toBe("Second edit");
    expect(input).toHaveValue("Second edit");
    expect(await saveRef.current?.()).toBe(true);
    expect(
      localStorage.getItem("cinakey.scriptDraft.project.plain"),
    ).toBeNull();
  });
});

it("supports keyboard completion in the middle of a mention and preserves following text", async () => {
  mount();
  await act(async () => {});
  const input = screen.getByRole("textbox", {
    name: "Script",
  }) as HTMLTextAreaElement;
  fireEvent.change(input, {
    target: { value: "Hello @james, goodbye.", selectionStart: 9 },
  });
  fireEvent.keyDown(input, { key: "Enter" });
  await act(async () => {});
  expect(input.value).toBe("Hello @james, goodbye.");
  expect(state.bind).toHaveBeenCalledWith({
    projectId: "project",
    alias: "james",
    assetId: "asset-james",
  });
});
it("dismisses completion with Escape without inserting or binding", async () => {
  mount();
  await act(async () => {});
  const input = screen.getByRole("textbox", { name: "Script" });
  fireEvent.change(input, { target: { value: "@", selectionStart: 1 } });
  expect(screen.getByRole("listbox")).toBeInTheDocument();
  fireEvent.keyDown(input, { key: "Escape" });
  expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  expect(state.bind).not.toHaveBeenCalled();
});

it("inserts dropped project media at the saved selection without altering surrounding text", async () => {
  mount();
  await act(async () => {});
  const input = screen.getByRole("textbox", {
    name: "Script",
  }) as HTMLTextAreaElement;
  fireEvent.change(input, {
    target: { value: "Before  after", selectionStart: 7, selectionEnd: 7 },
  });
  fireEvent.select(input, { target: { selectionStart: 7, selectionEnd: 7 } });
  fireEvent.drop(input, {
    dataTransfer: { getData: () => JSON.stringify({ assetId: "asset-james" }) },
  });
  await act(async () => {});
  expect(input.value).toBe("Before @james after");
  expect(state.bind).toHaveBeenCalledWith({
    projectId: "project",
    alias: "james",
    assetId: "asset-james",
  });
});
it("ignores media from outside the project's image and video candidates", async () => {
  mount();
  await act(async () => {});
  fireEvent.drop(screen.getByRole("textbox", { name: "Script" }), {
    dataTransfer: { getData: () => JSON.stringify({ assetId: "foreign" }) },
  });
  await act(async () => {});
  expect(state.bind).not.toHaveBeenCalled();
});

it("keeps the original insertion range while an upload is pending", async () => {
  let finish!: (ids: string[]) => void;
  state.upload.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  mount();
  await act(async () => {});
  const input = screen.getByRole("textbox", {
    name: "Script",
  }) as HTMLTextAreaElement;
  fireEvent.change(input, {
    target: { value: "Before @ after", selectionStart: 8 },
  });
  fireEvent.change(screen.getByLabelText("Upload & link"), {
    target: {
      files: [new File(["image"], "James.png", { type: "image/png" })],
    },
  });
  fireEvent.select(input, { target: { selectionStart: 0, selectionEnd: 0 } });
  await act(async () => {
    finish(["uploaded-james"]);
  });
  expect(input.value).toBe("Before @james after");
  expect(state.bind).toHaveBeenCalledWith({
    projectId: "project",
    alias: "james",
    assetId: "uploaded-james",
  });
});

it("opens the picker from a baked-in Markdown mention and counts mixed occurrences", async () => {
  state.text =
    "REFERENCES\n@[Image 1](image_1) = character. @image_1 moves. @[Image 2](image_2) stays.";
  mount();
  await act(async () => {});
  fireEvent.click(screen.getByText("@[Image 1](image_1)", { exact: true }));
  expect(
    screen.getByRole("option", { name: /Link James/ }),
  ).toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: /@image_1.*2 mentions/ }),
  ).toBeInTheDocument();
  fireEvent.click(screen.getByRole("option", { name: /Link James/ }));
  await act(async () => {});
  expect(state.bind).toHaveBeenCalledWith({
    projectId: "project",
    alias: "image_1",
    assetId: "asset-james",
  });
  expect(screen.getByRole("textbox", { name: "Script" })).toHaveValue(
    state.text,
  );
});

it("converts a pasted image reference to a video globally and restores its original spelling with undo", async () => {
  state.text =
    "@[Image 1](image_1) = character. @image_1 moves. @[IMAGE 2](IMAGE_2) stays.";
  const converted =
    "@[Video 1](video_1) = character. @video_1 moves. @[IMAGE 2](IMAGE_2) stays.";
  state.replace.mockResolvedValue({
    id: "converted",
    text: converted,
    alias: "video_1",
    previousVersionId: "tip",
    previousAssetId: null,
  });
  state.undoConversion.mockResolvedValue({ id: "restored", text: state.text });
  mount();
  await act(async () => {});
  fireEvent.click(screen.getByText("@[Image 1](image_1)", { exact: true }));
  fireEvent.click(screen.getByRole("option", { name: "Link Motion (video)" }));
  await act(async () => {});
  expect(state.replace).toHaveBeenCalledWith({
    projectId: "project",
    alias: "image_1",
    assetId: "asset-motion",
    expectedId: "tip",
    expectedAssetId: null,
  });
  expect(screen.getByRole("textbox", { name: "Script" })).toHaveValue(
    converted,
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Undo reference conversion" }),
  );
  await act(async () => {});
  expect(screen.getByRole("textbox", { name: "Script" })).toHaveValue(
    state.text,
  );
});

it.each(["@[Image 1](image_1)", "@image_1"])(
  "anchors the replacement picker beside clicked %s without scrolling the editor",
  async (mention) => {
    state.text = `Before ${mention} after`;
    const { container } = mount();
    await act(async () => {});
    const token = container.querySelector<HTMLElement>(".script-mention")!;
    const rect = new DOMRect(100, 120, 140, 20);
    const rectangles = vi
      .spyOn(token, "getClientRects")
      .mockReturnValue([rect] as unknown as DOMRectList);
    const input = screen.getByRole("textbox", {
      name: "Script",
    }) as HTMLTextAreaElement;
    input.scrollTop = 240;
    fireEvent.click(token, { clientX: 110, clientY: 130 });
    expect(screen.getByLabelText("Reference picker")).toHaveStyle({
      position: "fixed",
      left: "110px",
      top: "140px",
    });
    expect(input.scrollTop).toBe(240);
    rectangles.mockRestore();
  },
);
it("pauses autosave and makes an expired script read-only without losing the draft", async () => {
  vi.useFakeTimers();
  const view = mount();
  await act(async () => {});
  const editor = screen.getByRole("textbox", { name: "Script" });
  fireEvent.change(editor, { target: { value: "My unsaved draft" } });
  state.canWrite = false;
  view.rerender(
    <StudioScript
      projectId="project"
      onDirty={state.dirty}
      saveRef={view.saveRef}
    />,
  );
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1500);
  });
  expect(editor).toHaveAttribute("readonly");
  expect(editor).toHaveValue("My unsaved draft");
  expect(state.save).not.toHaveBeenCalled();
  expect(await view.saveRef.current!()).toBe(false);
  state.canWrite = true;
  view.rerender(
    <StudioScript
      projectId="project"
      onDirty={state.dirty}
      saveRef={view.saveRef}
    />,
  );
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1500);
  });
  expect(state.save).toHaveBeenCalledWith(
    expect.objectContaining({ text: "My unsaved draft" }),
  );
});
