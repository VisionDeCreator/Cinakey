import userEvent from "@testing-library/user-event";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { BillingPage } from "./BillingPage";
const state = vi.hoisted(() => ({
  canManage: true,
  workspaceId: "workspace",
  query: vi.fn(),
  invalidate: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/features/workspaces/workspace-context", () => ({
  useWorkspace: () => ({
    workspaceId: state.workspaceId,
    canManage: state.canManage,
    workspaces: [
      { workspace: { _id: state.workspaceId, name: "Cinema team" } },
    ],
  }),
}));
vi.mock("@/lib/api/context", () => ({
  useClient: () => ({ invalidate: state.invalidate }),
}));
vi.mock("@/lib/api/hooks", () => ({
  useQuery: (...args: unknown[]) => state.query(...args),
}));
vi.mock("./BillingSettings", () => ({
  BillingSettings: () => <p>Subscription controls</p>,
}));
vi.mock("./TeamSettings", () => ({ TeamSettings: () => <p>Team controls</p> }));
vi.mock("./BudgetSettings", () => ({
  BudgetSettings: () => <p>Budget controls</p>,
}));
beforeEach(() => {
  state.canManage = true;
  state.workspaceId = "workspace";
  state.query.mockReset().mockReturnValue([]);
});
afterEach(cleanup);
it("provides a dedicated workspace billing hub with truthful checkout return messaging", async () => {
  render(
    <MemoryRouter initialEntries={["/billing?billing=returned"]}>
      <BillingPage />
    </MemoryRouter>,
  );
  expect(
    screen.getByRole("heading", { name: "Billing", level: 1 }),
  ).toBeInTheDocument();
  expect(screen.getByRole("status")).toHaveTextContent(
    "does not confirm a successful payment",
  );
  expect(screen.getByText(/Cinema team/)).toBeInTheDocument();
  expect(screen.getByText("Subscription controls")).toBeInTheDocument();
  expect(screen.queryByText("Team controls")).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole("tab", { name: "Members & seats" }));
  expect(screen.getByText("Team controls")).toBeInTheDocument();
  expect(screen.queryByText("Subscription controls")).not.toBeInTheDocument();
  await userEvent.click(
    screen.getByRole("tab", { name: "Spending & budgets" }),
  );
  expect(screen.getByText("Budget controls")).toBeInTheDocument();
  await userEvent.click(screen.getByRole("tab", { name: "Balance activity" }));
  expect(state.query).toHaveBeenCalledWith(expect.anything(), {
    workspaceId: "workspace",
    limit: 100,
  });
});
it("denies financial sections and queries for Creators and Reviewers", () => {
  state.canManage = false;
  render(
    <MemoryRouter>
      <BillingPage />
    </MemoryRouter>,
  );
  expect(
    screen.getByText("Billing is managed by your workspace owner"),
  ).toBeInTheDocument();
  expect(screen.queryByText("Subscription controls")).not.toBeInTheDocument();
  expect(screen.queryByText("Team controls")).not.toBeInTheDocument();
  expect(state.query).not.toHaveBeenCalled();
});
it("renders balance activity as USD and switches the query scope with the workspace", () => {
  state.query.mockReturnValue([
    {
      _id: "row",
      createdAt: Date.UTC(2026, 9, 27),
      reason: "reserve",
      delta: -1_000_000,
      balanceAfter: 4_000_000,
    },
  ]);
  const view = render(
    <MemoryRouter initialEntries={["/billing#activity"]}>
      <BillingPage />
    </MemoryRouter>,
  );
  expect(
    screen.getByRole("table", { name: "Workspace balance activity" }),
  ).toHaveTextContent("−$1.00");
  state.workspaceId = "another";
  view.rerender(
    <MemoryRouter initialEntries={["/billing#activity"]}>
      <BillingPage />
    </MemoryRouter>,
  );
  expect(state.query).toHaveBeenLastCalledWith(expect.anything(), {
    workspaceId: "another",
    limit: 100,
  });
});

it("refreshes billing queries without navigating away", async () => {
  render(
    <MemoryRouter initialEntries={["/billing#members"]}>
      <BillingPage />
    </MemoryRouter>,
  );
  await userEvent.click(
    screen.getByRole("button", { name: "Refresh billing" }),
  );
  expect(state.invalidate).toHaveBeenCalledWith(
    expect.arrayContaining([
      "payments:summary",
      "billing:getBalance",
      "teams:members",
    ]),
  );
  expect(
    await screen.findByText("Billing data refreshed."),
  ).toBeInTheDocument();
  expect(screen.getByRole("tab", { name: "Members & seats" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
});
