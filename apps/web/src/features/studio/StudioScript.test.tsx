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
  text: "@image_1 meets @image_1. @james walks.",
  save: vi.fn(),
  bind: vi.fn(),
  dirty: vi.fn(),
}));
vi.mock("@/lib/api/hooks", () => ({
  useQuery: (ref: Parameters<typeof getFunctionName>[0]) => {
    switch (getFunctionName(ref)) {
      case "promptSheets:getTipForSequence":
        return { _id: "tip", renderedText: state.text, referenceMap: [] };
      case "assets:list":
        return [{ _id: "asset-james", name: "James", type: "image" }];
      default:
        return [];
    }
  },
  useAction: () => state.save,
  useMutation: () => state.bind,
}));
vi.mock("@/features/assets/useAssetUpload", () => ({
  useAssetUpload: () => ({ uploadFiles: vi.fn(), uploads: [] }),
}));
function mount() {
  const saveRef = { current: null as (() => Promise<boolean>) | null };
  return {
    ...render(
      <StudioScript
        projectId="project"
        sequenceId="scene"
        title="Scene"
        onDirty={state.dirty}
        saveRef={saveRef}
      />,
    ),
    saveRef,
  };
}
beforeEach(() => {
  state.text = "@image_1 meets @image_1. @james walks.";
  state.save.mockReset().mockResolvedValue({ promptSheetId: "saved" });
  state.bind
    .mockReset()
    .mockResolvedValue({ alias: "image_1", assetId: "asset-james" });
  state.dirty.mockReset();
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
    fireEvent.click(screen.getByRole("button", { name: /Link James/ }));
    await act(async () => {});
    expect(state.bind).toHaveBeenCalledWith({
      projectId: "project",
      alias: "image_1",
      assetId: "asset-james",
    });
    expect(screen.getByRole("textbox", { name: "Scene script" })).toHaveValue(
      state.text,
    );
  });
  it("completes a partial named mention even when the same reference already occurs earlier", async () => {
    mount();
    await act(async () => {});
    const input = screen.getByRole("textbox", {
      name: "Scene script",
    }) as HTMLTextAreaElement;
    fireEvent.change(input, {
      target: { value: "@james walks. @ja", selectionStart: 17 },
    });
    fireEvent.click(screen.getByRole("button", { name: /Link James/ }));
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
    let finish!: (result: { promptSheetId: string }) => void;
    state.save
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      )
      .mockResolvedValue({ promptSheetId: "second" });
    const { saveRef } = mount();
    await act(async () => {});
    const input = screen.getByRole("textbox", { name: "Scene script" });
    fireEvent.change(input, { target: { value: "First edit" } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1100);
    });
    fireEvent.change(input, { target: { value: "Second edit" } });
    expect(state.save).toHaveBeenCalledTimes(1);
    await act(async () => {
      finish({ promptSheetId: "first" });
    });
    expect(state.save).toHaveBeenCalledTimes(2);
    expect(state.save.mock.calls[1]![0].promptText).toBe("Second edit");
    expect(input).toHaveValue("Second edit");
    expect(await saveRef.current?.()).toBe(true);
    expect(
      localStorage.getItem("cinakey.scriptDraft.project.scene"),
    ).toBeNull();
  });
});
