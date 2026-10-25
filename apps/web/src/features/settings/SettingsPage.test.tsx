import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { getFunctionName } from "convex/server";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import { SettingsPage } from "./SettingsPage";

const state = vi.hoisted(() => ({
  viewer: { _id: "user", name: "Original", notificationEmailEnabled: true },
}));
vi.mock("@/lib/api/hooks", () => ({
  useQuery: (ref: Parameters<typeof getFunctionName>[0]) =>
    getFunctionName(ref) === "users:viewer" ? state.viewer : [],
  useMutation: () => vi.fn().mockResolvedValue(null),
}));
vi.mock("@convex-dev/auth/react", () => ({
  useAuthActions: () => ({ signOut: vi.fn() }),
}));
afterEach(cleanup);
it("keeps an unsaved profile draft during refreshes and resets it for another user", () => {
  state.viewer = {
    _id: "user",
    name: "Original",
    notificationEmailEnabled: true,
  };
  const view = render(
    <MemoryRouter>
      <SettingsPage />
    </MemoryRouter>,
  );
  fireEvent.change(screen.getByLabelText("Display name"), {
    target: { value: "My draft" },
  });
  state.viewer = { ...state.viewer, name: "Server refresh" };
  view.rerender(
    <MemoryRouter>
      <SettingsPage />
    </MemoryRouter>,
  );
  expect(screen.getByLabelText("Display name")).toHaveValue("My draft");
  state.viewer = { ...state.viewer, _id: "another", name: "Another user" };
  view.rerender(
    <MemoryRouter>
      <SettingsPage />
    </MemoryRouter>,
  );
  expect(screen.getByLabelText("Display name")).toHaveValue("Another user");
});
