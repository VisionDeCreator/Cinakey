import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { AppShell } from "./AppShell";

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
        name: "Test Creator",
        email: "creator@example.com",
        isStaff: true,
      };
    if (name.includes("listUnread")) return [];
    return { balance: 0 };
  },
  useMutation: () => vi.fn(),
}));
// API references are objects in Convex; use stable string refs to route the mocked queries.
vi.mock("@cinakey/backend", () => ({
  api: {
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
