import {
  cleanup,
  render,
  screen,
  fireEvent,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { getFunctionName } from "convex/server";
import { App } from "./App";
import { adminDestination } from "./routing";
const state = vi.hoisted(() => ({
  authenticated: true,
  loading: false,
  staff: true,
  reconnecting: false,
  retry: vi.fn(),
  query: vi.fn(),
  mutation: vi.fn(),
  signOut: vi.fn(),
}));
vi.mock("@convex-dev/auth/react", () => ({
  useAuthActions: () => ({ signOut: state.signOut, signIn: vi.fn() }),
}));
vi.mock("@cinakey/api-client", () => ({
  useConvexAuth: () => ({
    isAuthenticated: state.authenticated,
    isLoading: state.loading,
  }),
  useQuery: (ref: Parameters<typeof getFunctionName>[0], args: unknown) =>
    state.query(getFunctionName(ref), args),
  useQueryStatus: () => ({
    isReconnecting: state.reconnecting,
    retry: state.retry,
  }),
  useMutation: () => state.mutation,
}));
beforeEach(() => {
  state.authenticated = true;
  state.loading = false;
  state.staff = true;
  state.reconnecting = false;
  state.retry.mockReset().mockResolvedValue(undefined);
  state.query.mockReset().mockImplementation((name: string) => {
    if (name === "users:viewer") return { isStaff: state.staff };
    if (name === "staff:listUsers")
      return {
        page: [{ _id: "user-1", email: "owner@test.com", isStaff: false }],
        isDone: true,
        continueCursor: "",
      };
    if (name === "staff:listWorkspaces")
      return {
        page: [
          {
            _id: "workspace-1",
            name: "Internal",
            ownerEmail: "owner@test.com",
            billingMode: "internal",
          },
        ],
        isDone: true,
        continueCursor: "",
      };
    return undefined;
  });
  state.mutation.mockReset().mockResolvedValue("workspace-1");
  state.signOut.mockReset().mockResolvedValue(undefined);
  sessionStorage.clear();
});
afterEach(cleanup);
function page(path = "/users") {
  render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );
}
it("requires login and does not request staff data before authorization", () => {
  state.authenticated = false;
  page("/workspaces");
  expect(
    screen.getByRole("heading", { name: "Admin sign in" }),
  ).toBeInTheDocument();
  expect(
    state.query.mock.calls.some(([name]) => name.startsWith("staff:")),
  ).toBe(false);
});
it("denies non-administrators before rendering privileged tools", () => {
  state.staff = false;
  page();
  expect(screen.getByText("Administrator access required")).toBeInTheDocument();
  expect(
    state.query.mock.calls.some(([name]) => name.startsWith("staff:")),
  ).toBe(false);
  fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
  expect(state.signOut).toHaveBeenCalledOnce();
});
it("renders the user directory and migrated staff navigation for administrators", () => {
  page();
  expect(
    screen.getByRole("table", { name: "User accounts" }),
  ).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "owner@test.com" })).toHaveAttribute(
    "href",
    "/users/user-1",
  );
  for (const name of [
    "Workspaces",
    "Moderation",
    "Provider health",
    "Egress",
    "Audit log",
  ])
    expect(screen.getByRole("link", { name })).toBeInTheDocument();
});
it("creates company workspaces through the API with an explicit budget and reason", async () => {
  page("/workspaces");
  fireEvent.change(screen.getByLabelText("Owner email (existing account)"), {
    target: { value: "owner@test.com" },
  });
  fireEvent.change(screen.getByLabelText("Monthly company budget (USD)"), {
    target: { value: "25.50" },
  });
  fireEvent.change(screen.getByLabelText("Reason for company funding"), {
    target: { value: "Company test team" },
  });
  fireEvent.click(
    screen.getByRole("button", { name: "Create company workspace" }),
  );
  await waitFor(() =>
    expect(state.mutation).toHaveBeenCalledWith({
      ownerEmail: "owner@test.com",
      name: "Cinakey Internal",
      monthlyCapUsdMicros: 25_500_000,
      reason: "Company test team",
    }),
  );
});
it("restricts sign-in return destinations to local admin routes", () => {
  for (const value of [
    null,
    "https://evil.test",
    "//evil.test",
    "/\\evil.test",
    "/sign-in?next=/users",
  ])
    expect(adminDestination(value)).toBe("/users");
  expect(adminDestination("/workspaces/one")).toBe("/workspaces/one");
});

it.each(["/diagnostics/generation", "/diagnostics/upload"])(
  "returns not found for removed diagnostic route %s",
  (path) => {
    page(path);
    expect(
      screen.getByRole("heading", { name: "Page not found" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "Generation diagnostic" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "Upload diagnostic" }),
    ).not.toBeInTheDocument();
    expect(
      state.query.mock.calls.every(([name]) => name === "users:viewer"),
    ).toBe(true);
  },
);

it("shows an API outage and retries instead of waiting indefinitely for administrator access", () => {
  state.reconnecting = true;
  state.query.mockReturnValue(undefined);
  page();
  expect(
    screen.getByRole("heading", { name: "Cannot connect to the API" }),
  ).toBeInTheDocument();
  expect(
    screen.queryByText("Checking administrator access…"),
  ).not.toBeInTheDocument();
  expect(screen.queryByRole("link", { name: "Users" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Retry connection" }));
  expect(state.retry).toHaveBeenCalledOnce();
});
