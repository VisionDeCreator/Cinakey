import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppShell } from "./AppShell";

const accountState = vi.hoisted(() => ({
  servicesPaused: false,
  suspendedAt: undefined as number | undefined,
  generationPausedAt: undefined as number | undefined,
}));
afterEach(() => {
  accountState.servicesPaused = false;
  accountState.suspendedAt = undefined;
  accountState.generationPausedAt = undefined;
});
vi.mock("@/features/workspaces/WorkspaceContext", () => ({
  WorkspaceProvider: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock("@convex-dev/auth/react", () => ({
  useAuthActions: () => ({ signOut: vi.fn() }),
}));
vi.mock("@/lib/api/hooks", () => ({
  useQuery: (ref: unknown) => {
    const name = String(ref);
    if (name.includes("viewer"))
      return {
        ...accountState,
        name: "Test Creator",
        email: "creator@example.com",
        isStaff: true,
      };
    if (name.includes("availability"))
      return {
        models: accountState.servicesPaused
          ? [{ id: "deepseek", available: false }]
          : [],
      };
    if (name.includes("listUnread")) return [];
    return { balance: 0 };
  },
  useMutation: () => vi.fn(),
}));
// API references are objects in Convex; use stable string refs to route the mocked queries.
vi.mock("@cinakey/backend", () => ({
  api: {
    adminProviders: { availability: "availability" },
    users: { viewer: "viewer" },
    billing: { getBalance: "balance" },
    notifications: {
      listUnread: "listUnread",
      markRead: "markRead",
      markAllRead: "markAllRead",
    },
  },
}));
function setup() {
  render(
    <MemoryRouter initialEntries={["/projects"]}>
      <Routes>
        <Route element={<AppShell />}>
          <Route path="projects" element={<div>Project content</div>} />
          <Route path="settings" element={<h1>Profile settings</h1>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}
describe("dashboard account controls", () => {
  it("shows profile details in the sidebar and an avatar-only header menu", async () => {
    setup();
    const sidebar = screen.getByRole("button", {
      name: "Sidebar account menu",
    });
    expect(sidebar).toHaveTextContent("Test Creator");
    expect(sidebar).toHaveTextContent("creator@example.com");
    expect(
      screen.getByRole("button", { name: "Account menu" }),
    ).not.toHaveTextContent("creator@example.com");
    await userEvent.click(sidebar);
    await userEvent.click(
      screen.getByRole("menuitem", { name: "Profile & settings" }),
    );
    expect(
      screen.getByRole("heading", { name: "Profile settings" }),
    ).toBeInTheDocument();
  });
  it("opens header account and notification menus and keeps search in the header", async () => {
    setup();
    expect(
      screen.getByRole("textbox", { name: "Search projects" }),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Account menu" }));
    expect(
      screen.getByRole("menuitem", { name: "Sign out" }),
    ).toBeInTheDocument();
    await userEvent.keyboard("{Escape}");
    await userEvent.click(
      screen.getByRole("button", { name: "Notifications" }),
    );
    expect(screen.getByText("No unread notifications")).toBeInTheDocument();
  });
});

it("blocks the product shell for a suspended account and keeps sign-out available", () => {
  accountState.suspendedAt = Date.now();
  setup();
  expect(
    screen.getByRole("heading", { name: "Account suspended" }),
  ).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Sign out" })).toBeInTheDocument();
  expect(screen.queryByText("Project content")).not.toBeInTheDocument();
});
it("explains a generation pause while keeping existing project access", () => {
  accountState.generationPausedAt = Date.now();
  setup();
  expect(
    screen.getByText("Generation is paused for this account. Contact support."),
  ).toBeInTheDocument();
  expect(screen.getByText("Project content")).toBeInTheDocument();
});

it("explains provider pauses while keeping existing project content available", () => {
  accountState.servicesPaused = true;
  setup();
  expect(
    screen.getByText(/Some generation services are temporarily paused:/),
  ).toBeInTheDocument();
  expect(screen.getByText("Project content")).toBeInTheDocument();
});
