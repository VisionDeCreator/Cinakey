import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { setLocale } from "@dirrio/ui/i18n";
import { WorkspaceTrialNotice } from "./WorkspaceTrialNotice";
const HOUR = 3600_000;
const start = Date.UTC(2026, 9, 31, 12);
const props = {
  userId: "owner",
  workspaceId: "workspace",
  expiresAt: start + 120 * HOUR,
  status: "active" as const,
  isOwner: true,
};
function notice(
  overrides: Partial<Parameters<typeof WorkspaceTrialNotice>[0]> = {},
) {
  return (
    <MemoryRouter>
      <WorkspaceTrialNotice {...props} {...overrides} />
    </MemoryRouter>
  );
}
function dismiss() {
  fireEvent.click(
    screen.getByRole("button", { name: "Dismiss trial reminder" }),
  );
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(start);
  setLocale("en");
  const items = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => items.set(key, value),
    removeItem: (key: string) => items.delete(key),
  });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
it("explains paid generation and links the owner to the correct workspace billing page", () => {
  render(notice());
  expect(screen.getByRole("status")).toHaveTextContent(
    "AI generation credits are paid separately",
  );
  expect(screen.getByRole("status")).toHaveTextContent(
    "no automatic subscription charge",
  );
  expect(
    screen.getByRole("link", { name: "View subscription options" }),
  ).toHaveAttribute("href", "/billing/workspace");
});
it("remembers dismissal across reloads, retains a small status, and returns after 24 hours", async () => {
  const first = render(notice());
  dismiss();
  first.unmount();
  render(notice());
  expect(screen.queryByRole("status")).not.toBeInTheDocument();
  expect(screen.getByText(/^Trial ends/)).toBeInTheDocument();
  await act(() => vi.advanceTimersByTimeAsync(24 * HOUR - 1));
  expect(screen.queryByRole("status")).not.toBeInTheDocument();
  await act(() => vi.advanceTimersByTimeAsync(1));
  expect(screen.getByText("Your free trial is active")).toBeInTheDocument();
});
it("reopens the warning at the 48-hour stage and repeats every 12 hours when dismissed", async () => {
  render(notice({ expiresAt: start + 49 * HOUR }));
  dismiss();
  await act(() => vi.advanceTimersByTimeAsync(HOUR));
  expect(screen.getByText("Your free trial ends soon")).toBeInTheDocument();
  dismiss();
  await act(() => vi.advanceTimersByTimeAsync(12 * HOUR));
  expect(screen.getByText("Your free trial ends soon")).toBeInTheDocument();
});
it("shows expiry immediately despite a recent dismissal and retains credit and retention details", async () => {
  render(notice({ expiresAt: start + HOUR }));
  dismiss();
  await act(() => vi.advanceTimersByTimeAsync(HOUR));
  expect(screen.getByText("Your free trial has ended")).toBeInTheDocument();
  expect(screen.getByRole("status")).toHaveTextContent(
    "Purchased credits do not expire",
  );
  expect(screen.getByRole("status")).toHaveTextContent(
    "retained indefinitely for now",
  );
  dismiss();
  expect(screen.getByText("Trial ended")).toBeInTheDocument();
  await act(() => vi.advanceTimersByTimeAsync(24 * HOUR));
  expect(screen.getByText("Your free trial has ended")).toBeInTheDocument();
});
it("does not leak dismissals across accounts or workspaces and removes notices after subscribing", () => {
  const view = render(notice());
  dismiss();
  view.rerender(notice({ userId: "other" }));
  expect(screen.getByRole("status")).toBeInTheDocument();
  dismiss();
  view.rerender(notice({ workspaceId: "other-workspace" }));
  expect(screen.getByRole("status")).toBeInTheDocument();
  view.rerender(notice({ status: null }));
  expect(
    screen.queryByRole("region", { name: "Workspace trial" }),
  ).not.toBeInTheDocument();
});
it("supports manual reopening, non-owner guidance and unavailable storage", () => {
  vi.stubGlobal("localStorage", {
    getItem: () => {
      throw Error("Unavailable");
    },
    setItem: () => {
      throw Error("Unavailable");
    },
  });
  render(notice({ isOwner: false, status: "expired" }));
  expect(
    screen.getByText("Ask the workspace owner to subscribe."),
  ).toBeInTheDocument();
  expect(screen.queryByRole("link")).not.toBeInTheDocument();
  dismiss();
  fireEvent.click(screen.getByRole("button", { name: "Show trial details" }));
  expect(screen.getByText("Your free trial has ended")).toBeInTheDocument();
});
it("honors dismissals from another tab", () => {
  render(notice());
  const key = `dirrio.trial-reminder:owner:workspace:${props.expiresAt}`;
  localStorage.setItem(
    key,
    JSON.stringify({ stage: "active", until: start + 24 * HOUR }),
  );
  act(() => {
    window.dispatchEvent(new StorageEvent("storage", { key }));
  });
  expect(screen.queryByRole("status")).not.toBeInTheDocument();
});
