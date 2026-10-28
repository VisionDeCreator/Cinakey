import { afterEach, expect, it, vi } from "vitest";
import {
  GenerationSettingsDraft,
  type SavedGenerationSettings,
} from "./generationSettingsDraft";
const saved = (revision: number): SavedGenerationSettings => ({
  resolution: "720p",
  durationSec: 5,
  aspectRatio: "16:9",
  useStaging: false,
  revision,
});
afterEach(() => vi.useRealTimers());
it("debounces slider writes and flushes the final selection before generation", async () => {
  vi.useFakeTimers();
  const save = vi.fn().mockResolvedValue(saved(2));
  const draft = new GenerationSettingsDraft(save);
  draft.change({ durationSec: 8 }, 300);
  draft.change({ durationSec: 10 }, 300);
  await vi.advanceTimersByTimeAsync(299);
  expect(save).not.toHaveBeenCalled();
  expect(await draft.flush()).toBe(true);
  expect(save).toHaveBeenCalledExactlyOnceWith({ durationSec: 10 });
  expect(draft.getSnapshot().saved).toBe(true);
});
it("serializes writes and protects newer local changes from stale polling responses", async () => {
  let complete!: (result: SavedGenerationSettings) => void;
  const save = vi
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise<SavedGenerationSettings>((resolve) => {
          complete = resolve;
        }),
    )
    .mockResolvedValue(saved(3));
  const draft = new GenerationSettingsDraft(save);
  draft.change({ resolution: "1080p" });
  const pending = draft.flush();
  draft.change({ resolution: "720p", aspectRatio: "9:16" });
  draft.observe(saved(1));
  expect(draft.getSnapshot().patch).toMatchObject({
    resolution: "720p",
    aspectRatio: "9:16",
  });
  complete(saved(2));
  expect(await pending).toBe(true);
  expect(save.mock.calls).toEqual([
    [{ resolution: "1080p" }],
    [{ resolution: "720p", aspectRatio: "9:16" }],
  ]);
  draft.observe(saved(2));
  expect(draft.getSnapshot().patch).toMatchObject({ resolution: "720p" });
  draft.observe({ ...saved(3), aspectRatio: "9:16" });
  expect(draft.getSnapshot().patch).toEqual({});
});
it("retains failed edits, blocks a generation flush, and retries the same preferences", async () => {
  const save = vi
    .fn()
    .mockRejectedValueOnce(new Error("offline"))
    .mockResolvedValue(saved(2));
  const draft = new GenerationSettingsDraft(save);
  draft.change({ aspectRatio: "1:1" });
  expect(await draft.flush()).toBe(false);
  expect(draft.getSnapshot().error).toBe("offline");
  expect(await draft.flush()).toBe(false);
  expect(save).toHaveBeenCalledTimes(1);
  expect(await draft.retry()).toBe(true);
  expect(save).toHaveBeenLastCalledWith({ aspectRatio: "1:1" });
});
