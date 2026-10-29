import { renderHook, waitFor, cleanup, act } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useRegistrationPolicy } from "./useRegistrationPolicy";
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
it("defaults to approval and refreshes from the public setting, including focus changes", async () => {
  const fetch = vi
    .fn()
    .mockResolvedValue({
      ok: true,
      json: async () => ({ requireApproval: false }),
    });
  vi.stubGlobal("fetch", fetch);
  const { result } = renderHook(() => useRegistrationPolicy());
  expect(result.current).toBe(true);
  await waitFor(() => expect(result.current).toBe(false));
  fetch.mockResolvedValue({
    ok: true,
    json: async () => ({ requireApproval: true }),
  });
  act(() => window.dispatchEvent(new Event("focus")));
  await waitFor(() => expect(result.current).toBe(true));
  expect(fetch.mock.calls[0]![1]).toMatchObject({ cache: "no-store" });
});
it("returns to approval-required when a refresh fails instead of keeping stale open-registration copy", async () => {
  const fetch = vi
    .fn()
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({ requireApproval: false }),
    })
    .mockResolvedValue({ ok: false });
  vi.stubGlobal("fetch", fetch);
  const { result } = renderHook(() => useRegistrationPolicy());
  await waitFor(() => expect(result.current).toBe(false));
  act(() => window.dispatchEvent(new Event("focus")));
  await waitFor(() => expect(result.current).toBe(true));
});
