import { StrictMode } from "react";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { getFunctionName } from "convex/server";
import { useTimelineLease } from "./useTimelineLease";

const mocks = vi.hoisted(() => ({
  claim: vi.fn(),
  renew: vi.fn(),
  release: vi.fn(),
}));
vi.mock("@/lib/api/hooks", () => ({
  useMutation: (ref: Parameters<typeof getFunctionName>[0]) =>
    mocks[getFunctionName(ref).split(":")[1] as keyof typeof mocks],
}));
beforeEach(() => {
  vi.clearAllMocks();
  mocks.claim.mockResolvedValue({
    held: true,
    fence: 1,
    expiresAt: Date.now() + 90_000,
  });
  mocks.release.mockResolvedValue(undefined);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

it("keeps an occupied editor read-only until an explicit takeover", async () => {
  mocks.claim.mockResolvedValueOnce({
    held: false,
    editor: "Teammate",
    canTakeover: true,
  });
  const { result } = renderHook(() => useTimelineLease("project"));
  await waitFor(() => expect(result.current.editor).toBe("Teammate"));
  expect(result.current.canEdit).toBe(false);
  act(() => result.current.request(true));
  await waitFor(() => expect(result.current.canEdit).toBe(true));
  expect(mocks.claim.mock.calls[1]![0]).toMatchObject({ takeover: true });
});

it("stops editing immediately when a renewal fails and preserves the session fence", async () => {
  vi.useFakeTimers();
  mocks.renew.mockRejectedValue(new Error("Lease lost"));
  const { result } = renderHook(() => useTimelineLease("project"));
  await act(async () => {
    await Promise.resolve();
  });
  expect(result.current.canEdit).toBe(true);
  const sessionId = result.current.sessionId;
  await act(async () => {
    await vi.advanceTimersByTimeAsync(20_000);
  });
  expect(result.current.canEdit).toBe(false);
  expect(result.current.error).toContain("local draft is preserved");
  expect(mocks.renew).toHaveBeenCalledWith({
    projectId: "project",
    sessionId,
    fence: 1,
  });
});

it("releases a claim that arrives after the editor has unmounted", async () => {
  let finish!: (value: unknown) => void;
  mocks.claim.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const { unmount } = renderHook(() => useTimelineLease("project"));
  await waitFor(() => expect(finish).toBeTypeOf("function"));
  unmount();
  await act(async () => {
    finish({ held: true, fence: 7, expiresAt: Date.now() + 90_000 });
  });
  expect(mocks.release).toHaveBeenCalledWith(
    expect.objectContaining({ projectId: "project", fence: 7 }),
  );
});

it("releases editing access on full-page navigation and pauses a cached page", async () => {
  const { result } = renderHook(() => useTimelineLease("project"));
  await waitFor(() => expect(result.current.canEdit).toBe(true));
  const sessionId = result.current.sessionId;
  act(() => window.dispatchEvent(new Event("pagehide")));
  expect(result.current.canEditNow()).toBe(false);
  expect(result.current.canEdit).toBe(false);
  expect(mocks.release).toHaveBeenCalledWith({
    projectId: "project",
    sessionId,
    fence: 1,
  });
});

it("acquires once under StrictMode instead of racing its discarded setup", async () => {
  const { result } = renderHook(() => useTimelineLease("project"), {
    wrapper: StrictMode,
  });
  await waitFor(() => expect(result.current.canEdit).toBe(true));
  expect(mocks.claim).toHaveBeenCalledOnce();
  expect(mocks.release).not.toHaveBeenCalled();
});
it("releases a held lease when subscription access is lost and reacquires after recovery", async () => {
  const view = renderHook(
    ({ enabled }) => useTimelineLease("project", enabled),
    { initialProps: { enabled: true } },
  );
  await waitFor(() => expect(view.result.current.canEdit).toBe(true));
  view.rerender({ enabled: false });
  expect(view.result.current.canEditNow()).toBe(false);
  expect(view.result.current.canEdit).toBe(false);
  await waitFor(() => expect(mocks.release).toHaveBeenCalledOnce());
  expect(mocks.claim).toHaveBeenCalledOnce();
  view.rerender({ enabled: true });
  await waitFor(() => expect(view.result.current.canEdit).toBe(true));
  expect(mocks.claim).toHaveBeenCalledTimes(2);
});
it("does not request a lease while subscription write access is unavailable", async () => {
  const view = renderHook(() => useTimelineLease("project", false));
  await act(async () => {});
  expect(view.result.current.canEdit).toBe(false);
  expect(mocks.claim).not.toHaveBeenCalled();
});
