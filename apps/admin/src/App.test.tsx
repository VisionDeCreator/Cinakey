import { setLocale, t } from "@cinakey/ui/i18n";
import {
  act,
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
  roles: undefined as
    | undefined
    | (
        "platform_admin" | "support" | "billing" | "moderation" | "operations"
      )[],
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
  useAction: () => state.mutation,
}));
beforeEach(() => {
  state.authenticated = true;
  state.loading = false;
  state.staff = true;
  state.roles = undefined;
  state.reconnecting = false;
  state.retry.mockReset().mockResolvedValue(undefined);
  state.query.mockReset().mockImplementation((name: string) => {
    if (name === "users:viewer")
      return { isStaff: state.staff, adminRoles: state.roles };
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

it("hides privileged navigation and funding forms from support accounts", () => {
  state.roles = ["support"];
  page();
  expect(screen.getByRole("link", { name: "Users" })).toBeInTheDocument();
  expect(
    screen.queryByRole("link", { name: "Administration" }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("link", { name: "Audit log" }),
  ).not.toBeInTheDocument();
  expect(
    state.query.mock.calls.some(([name]) => name === "staff:lookupUser"),
  ).toBe(false);
});
it("blocks direct navigation before querying a section without permission", () => {
  state.roles = ["support"];
  page("/providers");
  expect(screen.getByRole("alert")).toHaveTextContent(
    "You do not have permission",
  );
  expect(
    state.query.mock.calls.some(([name]) => name === "staff:providerHealth"),
  ).toBe(false);
});
it("shows role management to platform administrators", () => {
  page("/administration");
  expect(
    screen.getByRole("heading", { name: "Administration" }),
  ).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Save roles" })).toBeDisabled();
  expect(
    state.query.mock.calls.some(
      ([name]) => name === "adminAccess:listAdministrators",
    ),
  ).toBe(true);
});

it("requires review and a reason, then preserves the role change request ID across a failed response", async () => {
  state.mutation
    .mockRejectedValueOnce(new Error("Connection lost"))
    .mockResolvedValueOnce(undefined);
  page("/administration");
  fireEvent.change(screen.getByLabelText("Account email"), {
    target: { value: "support@test.com" },
  });
  fireEvent.click(screen.getByLabelText("Support"));
  fireEvent.change(screen.getByLabelText("Reason"), {
    target: { value: "Support team access" },
  });
  const save = screen.getByRole("button", { name: "Save roles" });
  expect(save).toBeDisabled();
  fireEvent.click(screen.getByLabelText("I have reviewed this access change."));
  fireEvent.click(save);
  await waitFor(() =>
    expect(screen.getByText("Connection lost")).toBeInTheDocument(),
  );
  fireEvent.click(screen.getByRole("button", { name: "Save roles" }));
  await waitFor(() =>
    expect(screen.getByText("Roles updated.")).toBeInTheDocument(),
  );
  expect(state.mutation).toHaveBeenCalledTimes(2);
  expect(state.mutation.mock.calls[0]![0]).toMatchObject({
    email: "support@test.com",
    roles: ["support"],
    reason: "Support team access",
    requestId: expect.any(String),
  });
  expect(state.mutation.mock.calls[1]![0].requestId).toBe(
    state.mutation.mock.calls[0]![0].requestId,
  );
});

it("blocks support accounts from operational data", () => {
  state.roles = ["support"];
  page("/operations");
  expect(screen.getByRole("alert")).toHaveTextContent(
    "You do not have permission",
  );
  expect(
    state.query.mock.calls.some(([name]) =>
      name.startsWith("adminOperations:"),
    ),
  ).toBe(false);
});
it("shows the operations overview without platform-only configuration to operations staff", () => {
  state.roles = ["operations"];
  const original = state.query.getMockImplementation()!;
  const zero = { value: 0, capped: false };
  state.query.mockImplementation((name: string, args: unknown) => {
    if (name === "adminOperations:overview")
      return {
        observedAt: Date.now(),
        monitorStartedAt: null,
        monitorLastEvaluatedAt: null,
        config: {
          enabled: true,
          expectedWorkers: 1,
          staleAfterSec: 90,
          backlogThreshold: 100,
          overdueSec: 300,
          generationFailureThreshold: 5,
        },
        healthyWorkers: 0,
        workers: [],
        workersCapped: false,
        queue: {
          scheduled: zero,
          due: { value: 1000, capped: true },
          running: zero,
          failed: zero,
          expired: zero,
          oldestDueAt: null,
        },
        uncertain: zero,
        billingReviews: zero,
        paymentReviews: zero,
        recentFailedTasks: zero,
        recentFailedGenerations: zero,
      };
    if (name === "adminOperations:listIncidents")
      return { active: [], recentResolved: [], capped: false };
    return original(name, args);
  });
  page("/operations");
  expect(
    screen.getByRole("heading", { name: "Operations overview" }),
  ).toBeInTheDocument();
  expect(screen.getByText("1000+")).toBeInTheDocument();
  expect(screen.getByText(/No worker heartbeat observed/)).toBeInTheDocument();
  expect(
    screen.queryByRole("heading", { name: "Monitoring settings" }),
  ).not.toBeInTheDocument();
});

it("shows production job search to support without loading recovery tools", () => {
  state.roles = ["support"];
  const original = state.query.getMockImplementation()!;
  state.query.mockImplementation((name: string, args: unknown) =>
    name === "adminJobs:list"
      ? { page: [], isDone: true, continueCursor: "" }
      : original(name, args),
  );
  page("/jobs");
  expect(
    screen.getByRole("heading", { name: "Generation jobs" }),
  ).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("Creator email or user ID"), {
    target: { value: "creator@test.com" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Apply filters" }));
  expect(state.query).toHaveBeenCalledWith(
    "adminJobs:list",
    expect.objectContaining({
      user: "creator@test.com",
      paginationOpts: { cursor: null, numItems: 25 },
    }),
  );
  expect(
    screen.queryByRole("button", { name: "Check provider status" }),
  ).not.toBeInTheDocument();
});
it("keeps private content and recovery controls out of support job details", () => {
  state.roles = ["support"];
  const original = state.query.getMockImplementation()!;
  state.query.mockImplementation((name: string, args: unknown) =>
    name === "adminJobs:detail"
      ? {
          job: {
            _id: "job-1",
            model: "seedance-2.5",
            status: "submitted",
            createdBy: "user-1",
            projectId: "project-1",
            workspaceId: "workspace-1",
            createdAt: Date.now(),
            updatedAt: Date.now(),
            attempts: 1,
            providerJobId: "provider-1",
            submissionState: "accepted",
            financial: null,
          },
          tasks: [],
          observations: [],
          events: [],
          actions: [],
          reviews: [],
          outputs: [],
          ledger: [],
        }
      : original(name, args),
  );
  page("/jobs/job-1");
  expect(
    screen.getByRole("heading", { name: "Job details" }),
  ).toBeInTheDocument();
  expect(
    screen.queryByRole("heading", { name: "Controlled recovery" }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("heading", { name: "Private prompt and error details" }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "View and audit access" }),
  ).not.toBeInTheDocument();
});
it("shows workspace balances and signed ledger USD amounts without scaling them twice", async () => {
  state.roles = ["billing"];
  const previous = state.query.getMockImplementation()!;
  state.query.mockImplementation((name: string, args: unknown) => {
    if (name === "adminBilling:workspace")
      return {
        workspace: {
          id: "workspace-1",
          name: "Billing test",
          billingMode: "paid",
        },
        account: {
          available: 1234567,
          reserved: 2000000,
          spent: 3000000,
          funded: 6234567,
        },
        payment: null,
        environment: "sandbox",
      };
    if (name === "adminBilling:history")
      return {
        page: [
          {
            _id: "ledger-1",
            reason: "reserve",
            delta: -2000000,
            balanceAfter: 1234567,
            sequence: 2,
            jobId: "job-1",
          },
        ],
        isDone: true,
        continueCursor: "",
      };
    return previous(name, args);
  });
  render(
    <MemoryRouter initialEntries={["/billing/workspace-1"]}>
      <App />
    </MemoryRouter>,
  );
  expect(
    screen.getByRole("heading", { name: "Billing test: finances" }),
  ).toBeTruthy();
  expect(screen.getByText("$1.234567")).toBeTruthy();
  expect(screen.getByText(/Change.*−\$2.00/)).toBeTruthy();
  expect(
    screen.getByRole("link", { name: "Generation job" }).getAttribute("href"),
  ).toBe("/jobs/job-1");
});
it("denies support access to Billing before querying financial data", () => {
  state.roles = ["support"];
  render(
    <MemoryRouter initialEntries={["/billing"]}>
      <App />
    </MemoryRouter>,
  );
  expect(
    screen.getByText("You do not have permission to view this section."),
  ).toBeTruthy();
  expect(
    state.query.mock.calls.some(([name]) =>
      String(name).startsWith("adminBilling:"),
    ),
  ).toBe(false);
});
it("shows support staff the internal history without account controls", () => {
  state.roles = ["support"];
  const previous = state.query.getMockImplementation()!;
  state.query.mockImplementation((name: string, args: unknown) => {
    if (name === "adminSupport:detail")
      return {
        type: "user",
        id: "user-1",
        name: "Support customer",
        email: "customer@test.com",
        isStaff: false,
        supportRevision: 0,
        workspaces: [],
        memberships: [],
        truncated: false,
      };
    if (name === "adminSupport:notes")
      return {
        page: [
          {
            _id: "note-1",
            text: "Investigated a customer issue",
            createdBy: "staff-1",
            authorEmail: "agent@test.com",
            createdAt: Date.now(),
          },
        ],
        isDone: true,
        continueCursor: "",
      };
    if (name === "adminSupport:cases")
      return { page: [], isDone: true, continueCursor: "" };
    return previous(name, args);
  });
  render(
    <MemoryRouter initialEntries={["/support/user/user-1"]}>
      <App />
    </MemoryRouter>,
  );
  expect(screen.getByText("Investigated a customer issue")).toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: "Add internal note" }),
  ).toBeInTheDocument();
  expect(
    screen.queryByRole("heading", { name: "Access controls" }),
  ).not.toBeInTheDocument();
});
it("denies billing staff access to private support notes before querying them", () => {
  state.roles = ["billing"];
  render(
    <MemoryRouter initialEntries={["/support/user/user-1"]}>
      <App />
    </MemoryRouter>,
  );
  expect(
    screen.getByText("You do not have permission to view this section."),
  ).toBeInTheDocument();
  expect(
    state.query.mock.calls.some(([name]) =>
      String(name).startsWith("adminSupport:"),
    ),
  ).toBe(false);
});
it("allows operations to inspect storage metadata without content or cleanup controls", () => {
  state.roles = ["operations"];
  const previous = state.query.getMockImplementation()!;
  state.query.mockImplementation((name: string, args: unknown) =>
    name === "adminMedia:inventory"
      ? {
          page: [
            {
              id: "file-1",
              size: 100,
              contentType: "image/png",
              createdAt: Date.now() - 72 * 3600000,
              control: null,
              cleanup: null,
              refs: {
                asset: false,
                media: false,
                publication: false,
                staged: false,
                upload: false,
              },
              cleanupEligible: true,
            },
          ],
          isDone: true,
          continueCursor: "",
        }
      : previous(name, args),
  );
  render(
    <MemoryRouter initialEntries={["/storage"]}>
      <App />
    </MemoryRouter>,
  );
  expect(
    screen.getByRole("heading", { name: "Storage inventory" }),
  ).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "file-1" })).toHaveAttribute(
    "href",
    "/storage/files/file-1",
  );
  expect(
    screen.queryByRole("button", { name: "Review orphan cleanup" }),
  ).not.toBeInTheDocument();
  expect(state.mutation).not.toHaveBeenCalled();
});
it("requires reviewing an orphan before exposing the permanent cleanup action", () => {
  const previous = state.query.getMockImplementation()!;
  state.query.mockImplementation((name: string, args: unknown) =>
    name === "adminMedia:inventory"
      ? {
          page: [
            {
              id: "file-1",
              size: 100,
              contentType: "image/png",
              createdAt: Date.now() - 72 * 3600000,
              control: null,
              cleanup: null,
              refs: {
                asset: false,
                media: false,
                publication: false,
                staged: false,
                upload: false,
              },
              cleanupEligible: true,
            },
          ],
          isDone: true,
          continueCursor: "",
        }
      : previous(name, args),
  );
  render(
    <MemoryRouter initialEntries={["/storage"]}>
      <App />
    </MemoryRouter>,
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Review orphan cleanup" }),
  );
  expect(
    screen.queryByRole("button", { name: "Queue permanent cleanup" }),
  ).not.toBeInTheDocument();
  fireEvent.click(
    screen.getByLabelText(
      "I reviewed this file and authorize permanent deletion.",
    ),
  );
  expect(
    screen.getByRole("button", { name: "Queue permanent cleanup" }),
  ).toBeInTheDocument();
  expect(state.mutation).not.toHaveBeenCalled();
});
it("shows media controls to moderators without automatically opening private media", () => {
  state.roles = ["moderation"];
  const previous = state.query.getMockImplementation()!;
  state.query.mockImplementation((name: string, args: unknown) =>
    name === "adminMedia:detail"
      ? {
          storageId: "file-1",
          size: 100,
          contentType: "video/mp4",
          provider: "r2",
          control: { revision: 7, quarantined: true, retentionHold: true },
          aliases: [],
          publications: [],
          truncated: false,
        }
      : previous(name, args),
  );
  render(
    <MemoryRouter initialEntries={["/storage/files/file-1"]}>
      <App />
    </MemoryRouter>,
  );
  expect(screen.getByLabelText("Media quarantined")).toBeChecked();
  expect(screen.getByLabelText("Retention hold")).toBeChecked();
  expect(
    screen.getByRole("button", { name: "Open media preview" }),
  ).toBeInTheDocument();
  expect(state.mutation).not.toHaveBeenCalled();
});
function providerOverview() {
  return {
    day: "2026-10-29",
    month: "2026-10",
    accounting: { ready: true, running: false, processed: 10, taskState: null },
    scopes: [
      {
        key: "global",
        policy: null,
        all: { reserved: 2000000, spent: 1000000, active: 2 },
        day: { spent: 1000000 },
        month: { spent: 1000000 },
      },
    ],
    models: [{ id: "deepseek", provider: "deepseek", kind: "text" }],
    pricing: {
      priceVersion: "deployed-rate-version",
      markupBps: 500,
      video: { "seedance-2.5": { "720p": 100000, "1080p": 200000 } },
      tokens: { input: 300000, cachedInput: 6000, output: 1200000 },
      textModel: "deepseek-flash",
    },
  };
}
it("lets operations pause work without exposing limit edits or resume controls", async () => {
  state.roles = ["operations"];
  const previous = state.query.getMockImplementation()!;
  state.query.mockImplementation((name: string, args: unknown) =>
    name === "adminProviders:overview"
      ? providerOverview()
      : previous(name, args),
  );
  render(
    <MemoryRouter initialEntries={["/provider-controls"]}>
      <App />
    </MemoryRouter>,
  );
  expect(
    screen.getByRole("heading", { name: "Provider and spend controls" }),
  ).toBeInTheDocument();
  expect(
    screen.queryByText("Edit limits and pause state"),
  ).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("Pause new paid work reason"), {
    target: { value: "Stop provider requests during the incident" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Pause new paid work" }));
  await waitFor(() =>
    expect(state.mutation).toHaveBeenCalledWith(
      expect.objectContaining({
        key: "global",
        reason: "Stop provider requests during the incident",
        requestId: expect.any(String),
      }),
    ),
  );
});
it("converts provider limit form dollars to integer micros and preserves zero caps", async () => {
  const previous = state.query.getMockImplementation()!;
  state.query.mockImplementation((name: string, args: unknown) =>
    name === "adminProviders:overview"
      ? providerOverview()
      : previous(name, args),
  );
  render(
    <MemoryRouter initialEntries={["/provider-controls"]}>
      <App />
    </MemoryRouter>,
  );
  fireEvent.click(screen.getByText("Edit limits and pause state"));
  fireEvent.change(screen.getByLabelText("global Maximum request USD"), {
    target: { value: "0.250001" },
  });
  fireEvent.change(screen.getByLabelText("global UTC daily USD limit"), {
    target: { value: "0" },
  });
  fireEvent.change(screen.getByLabelText("Save provider controls reason"), {
    target: { value: "Set reviewed request and daily limits" },
  });
  fireEvent.click(
    screen.getByRole("button", { name: "Save provider controls" }),
  );
  await waitFor(() =>
    expect(state.mutation).toHaveBeenCalledWith(
      expect.objectContaining({
        key: "global",
        maxRequest: 250001,
        dailyCap: 0,
        monthlyCap: null,
        maxOutstanding: null,
        expectedRevision: 0,
      }),
    ),
  );
});
it("denies support access to private provider usage before querying it", () => {
  state.roles = ["support"];
  render(
    <MemoryRouter initialEntries={["/provider-controls"]}>
      <App />
    </MemoryRouter>,
  );
  expect(
    screen.getByText("You do not have permission to view this section."),
  ).toBeInTheDocument();
  expect(
    state.query.mock.calls.some(
      ([name]) => String(name) === "adminProviders:overview",
    ),
  ).toBe(false);
});
it("shows analytics definitions and report creation for operations", async () => {
  state.roles = ["operations"];
  render(
    <MemoryRouter initialEntries={["/analytics"]}>
      <App />
    </MemoryRouter>,
  );
  expect(
    await screen.findByRole("heading", { name: "Analytics and reporting" }),
  ).toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: "Build report" }),
  ).toBeInTheDocument();
  expect(screen.getByText("Definitions and data coverage")).toBeInTheDocument();
});
it("denies analytics to support staff", async () => {
  state.roles = ["support"];
  render(
    <MemoryRouter initialEntries={["/analytics"]}>
      <App />
    </MemoryRouter>,
  );
  expect(
    screen.queryByRole("button", { name: "Build report" }),
  ).not.toBeInTheDocument();
  expect(
    state.query.mock.calls.some(([name]) => name === "adminAnalytics:list"),
  ).toBe(false);
});

it("translates the report form immediately without losing its unsaved reason", async () => {
  state.roles = ["operations"];
  render(
    <MemoryRouter initialEntries={["/analytics"]}>
      <App />
    </MemoryRouter>,
  );
  fireEvent.change(screen.getByRole("textbox", { name: "Report reason" }), {
    target: { value: "Unsubmitted reason to preserve" },
  });
  act(() => setLocale("fr"));
  try {
    expect(
      screen.getByRole("heading", { name: t("Analytics and reporting") }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("textbox", { name: t("Report reason") }),
    ).toHaveValue("Unsubmitted reason to preserve");
    expect(
      screen.getByRole("button", { name: t("Build report") }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: t("Provider controls") }),
    ).toBeInTheDocument();
  } finally {
    act(() => setLocale("en"));
  }
});
