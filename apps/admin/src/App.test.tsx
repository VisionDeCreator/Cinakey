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
    "Directory",
    "Moderation",
    "Providers",
    "Analytics",
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
  expect(screen.getByRole("link", { name: "Directory" })).toBeInTheDocument();
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
  fireEvent.click(screen.getByRole("checkbox", { name: "Support" }));
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
  expect(screen.getAllByText("1,000+").length).toBeGreaterThan(0);
  fireEvent.click(screen.getByRole("button", { name: "Worker instances" }));
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
  fireEvent.click(screen.getByText("Quick pause"));
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
      screen.getByRole("link", { name: t("Providers") }),
    ).toBeInTheDocument();
  } finally {
    act(() => setLocale("en"));
  }
});

it("collapses the navigation while keeping account controls and link labels", () => {
  const stored = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => stored.set(key, value),
  });
  page("/directory");
  fireEvent.click(screen.getByRole("button", { name: "Collapse sidebar" }));
  expect(document.querySelector(".admin-shell")).toHaveClass(
    "admin-shell-collapsed",
  );
  expect(screen.getByRole("button", { name: "Sign out" })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Directory" })).toBeInTheDocument();
  expect(localStorage.getItem("cinakey.admin.sidebar.collapsed")).toBe("true");
  fireEvent.click(screen.getByRole("button", { name: "Expand sidebar" }));
  expect(document.querySelector(".admin-shell")).not.toHaveClass(
    "admin-shell-collapsed",
  );
  vi.unstubAllGlobals();
});
it("switches directory tabs and preserves the legacy workspaces route", () => {
  page("/workspaces");
  expect(screen.getByRole("table", { name: "Workspaces" })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Users" }));
  expect(
    screen.getByRole("table", { name: "User accounts" }),
  ).toBeInTheDocument();
  expect(
    screen.queryByRole("table", { name: "Workspaces" }),
  ).not.toBeInTheDocument();
});
it("does not mount financial reports for a role lacking analytics permission", () => {
  state.roles = ["support"];
  page("/analytics?tab=transfers");
  expect(screen.getByRole("alert")).toHaveTextContent(
    "You do not have permission",
  );
  expect(
    state.query.mock.calls.some(
      ([name]) =>
        name.startsWith("adminAnalytics:") || name === "staff:monthlyEgress",
    ),
  ).toBe(false);
});

it("selects a provider scope without mixing its limits or global totals", async () => {
  const data = providerOverview();
  data.scopes.push({
    key: "provider:deepseek",
    policy: null,
    all: { reserved: 500000, spent: 0, active: 1 },
    day: { spent: 0 },
    month: { spent: 0 },
  });
  const previous = state.query.getMockImplementation()!;
  state.query.mockImplementation((name: string, args: unknown) =>
    name === "adminProviders:overview" ? data : previous(name, args),
  );
  render(
    <MemoryRouter initialEntries={["/providers?tab=controls"]}>
      <App />
    </MemoryRouter>,
  );
  // Summary comes from the global ledger, not a double-counted sum of child scopes.
  expect(screen.getAllByText("$3.00")).toHaveLength(3);
  fireEvent.change(screen.getByLabelText("global Maximum request USD"), {
    target: { value: "12" },
  });
  fireEvent.click(
    screen.getByRole("button", { name: "Review provider:deepseek" }),
  );
  expect(
    screen.getByLabelText("provider:deepseek Maximum request USD"),
  ).toHaveValue(null);
  fireEvent.change(
    screen.getByLabelText("provider:deepseek Maximum request USD"),
    { target: { value: "0" } },
  );
  fireEvent.change(screen.getByLabelText("Save provider controls reason"), {
    target: { value: "Reviewed provider scope limit" },
  });
  fireEvent.click(
    screen.getByRole("button", { name: "Save provider controls" }),
  );
  await waitFor(() =>
    expect(state.mutation).toHaveBeenCalledWith(
      expect.objectContaining({
        key: "provider:deepseek",
        maxRequest: 0,
        expectedRevision: 0,
      }),
    ),
  );
  fireEvent.change(screen.getByLabelText("Search scopes"), {
    target: { value: "missing" },
  });
  expect(screen.getByText("No scopes match your search.")).toHaveAttribute(
    "role",
    "status",
  );
});

it("selects report history and preserves completed and running report actions", () => {
  const previous = state.query.getMockImplementation()!;
  const reports = [
    {
      _id: "report-1",
      from: Date.UTC(2026, 9, 1),
      to: Date.UTC(2026, 9, 28),
      status: "completed",
    },
    {
      _id: "report-2",
      from: Date.UTC(2026, 8, 1),
      to: Date.UTC(2026, 8, 30),
      status: "running",
    },
  ];
  state.query.mockImplementation((name: string, args: unknown) => {
    if (name === "adminAnalytics:list")
      return { page: reports, isDone: true, continueCursor: "" };
    if (name === "adminAnalytics:detail")
      return {
        ...reports.find(
          (r) => r._id === (args as { reportId: string }).reportId,
        ),
        createdAt: Date.UTC(2026, 9, 29),
        processed: 12,
        stageName: "finished",
        taskState: null,
        financial: false,
        metrics: {
          jobs: 12,
          activeAccounts: 3,
          jobsSucceeded: 10,
          jobsFailed: 2,
        },
      };
    if (name === "adminAnalytics:rows")
      return {
        page: [{ key: "2026-10-27", metrics: { jobs: 12 } }],
        isDone: true,
        continueCursor: "",
      };
    return previous(name, args);
  });
  page("/analytics");
  expect(
    screen.getByRole("table", { name: "Report breakdown" }),
  ).toHaveTextContent("2026-10-27");
  expect(
    screen.getByRole("button", { name: "Export grouping CSV" }),
  ).toBeDisabled();
  expect(
    screen.queryByText("Known supplier cost (USD)"),
  ).not.toBeInTheDocument();
  fireEvent.click(
    screen.getByRole("button", { name: /2026-09-01 → 2026-09-30/ }),
  );
  expect(
    screen.queryByRole("table", { name: "Report breakdown" }),
  ).not.toBeInTheDocument();
  fireEvent.click(screen.getByText("Manage report"));
  expect(screen.getByRole("button", { name: "Cancel report" })).toBeDisabled();
  fireEvent.change(screen.getByLabelText("Report action reason"), {
    target: { value: "Reviewed report worker recovery" },
  });
  expect(
    screen.getByRole("button", { name: "Resume failed report" }),
  ).toBeEnabled();
  expect(state.mutation).not.toHaveBeenCalled();
});

it("builds analytics reports with inclusive and exclusive UTC boundaries", async () => {
  page("/analytics");
  fireEvent.change(screen.getByLabelText("From (inclusive)"), {
    target: { value: "2026-10-01" },
  });
  fireEvent.change(screen.getByLabelText("To (exclusive)"), {
    target: { value: "2026-10-28" },
  });
  fireEvent.change(screen.getByLabelText("Workspace ID"), {
    target: { value: " workspace-1 " },
  });
  fireEvent.change(screen.getByLabelText("Report reason"), {
    target: { value: "Verify recorded usage for October" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Build report" }));
  await waitFor(() =>
    expect(state.mutation).toHaveBeenCalledWith(
      expect.objectContaining({
        from: Date.UTC(2026, 9, 1),
        to: Date.UTC(2026, 9, 28),
        workspaceId: "workspace-1",
        reason: "Verify recorded usage for October",
        requestId: expect.any(String),
      }),
    ),
  );
});

it("searches administrators and resets review when switching accounts", () => {
  const previous = state.query.getMockImplementation()!;
  state.query.mockImplementation((name: string, args: unknown) =>
    name === "adminAccess:listAdministrators"
      ? {
          page: [
            { userId: "staff-1", email: "alex@test.com", roles: ["support"] },
            {
              userId: "staff-2",
              email: "taylor@test.com",
              roles: ["operations"],
            },
          ],
          isDone: true,
          continueCursor: "",
        }
      : previous(name, args),
  );
  page("/administration");
  fireEvent.click(
    screen.getByRole("button", { name: "Edit roles for alex@test.com" }),
  );
  expect(screen.getByRole("checkbox", { name: "Support" })).toBeChecked();
  fireEvent.change(screen.getByLabelText("Reason"), {
    target: { value: "Reviewed support access" },
  });
  fireEvent.click(screen.getByLabelText("I have reviewed this access change."));
  expect(screen.getByRole("button", { name: "Save roles" })).toBeEnabled();
  fireEvent.click(
    screen.getByRole("button", { name: "Edit roles for taylor@test.com" }),
  );
  expect(screen.getByLabelText("Account email")).toHaveValue("taylor@test.com");
  expect(screen.getByRole("checkbox", { name: "Operations" })).toBeChecked();
  expect(screen.getByLabelText("Reason")).toHaveValue("");
  expect(
    screen.getByLabelText("I have reviewed this access change."),
  ).not.toBeChecked();
  expect(screen.getByRole("button", { name: "Save roles" })).toBeDisabled();
  fireEvent.change(screen.getByLabelText("Search accounts on this page"), {
    target: { value: "ALEX" },
  });
  expect(
    screen.queryByRole("button", { name: "Edit roles for taylor@test.com" }),
  ).not.toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: "Edit roles for alex@test.com" }),
  ).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("Search accounts on this page"), {
    target: { value: "missing" },
  });
  expect(
    screen.getByText("No accounts match your search."),
  ).toBeInTheDocument();
  expect(state.mutation).not.toHaveBeenCalled();
});

it("localizes billing environments, payment states and USD amounts while preserving operator notes", () => {
  state.roles = ["billing"];
  const previous = state.query.getMockImplementation()!;
  state.query.mockImplementation((name: string, args: unknown) => {
    if (name === "adminBilling:workspace")
      return {
        workspace: {
          id: "workspace-review",
          name: "Review workspace",
          billingMode: "internal",
        },
        account: { available: 0, reserved: 0, spent: 0, funded: 0 },
        payment: null,
        environment: "sandbox",
      };
    if (name === "adminBilling:history")
      return {
        page:
          (args as { kind: string }).kind === "orders"
            ? [
                {
                  _id: "order-review",
                  kind: "topup",
                  environment: "sandbox",
                  netCents: 12345,
                  refundedCents: 345,
                  grantedUsdMicros: 123450000,
                  reversedUsdMicros: 3450000,
                },
              ]
            : (args as { kind: string }).kind === "refunds"
              ? [
                  {
                    _id: "refund-review",
                    status: "uncertain",
                    environment: "sandbox",
                    amountCents: 678,
                    requestId: "review-request",
                    reason: "Operator evidence stays verbatim",
                  },
                ]
              : [],
        isDone: true,
        continueCursor: "",
      };
    return previous(name, args);
  });
  render(
    <MemoryRouter initialEntries={["/billing/workspace-review"]}>
      <App />
    </MemoryRouter>,
  );
  act(() => setLocale("fr"));
  try {
    fireEvent.click(screen.getByRole("button", { name: t("orders") }));
    expect(screen.getByRole("table")).toHaveTextContent(t("Net amount"));
    expect(
      screen.getByRole("button", { name: t("First page") }),
    ).toBeDisabled();
    expect(screen.getAllByText(/123,45/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/3,45/).length).toBeGreaterThan(0);
    expect(screen.getByText(t("topup"), { exact: false })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: t("refunds") }));
    expect(screen.getByText(/6,78/)).toBeInTheDocument();
    expect(
      screen.getByText(t("Request: {id}", { id: "review-request" }), {
        exact: false,
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Operator evidence stays verbatim", { exact: false }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(t("uncertain"), { exact: false }),
    ).toBeInTheDocument();
  } finally {
    act(() => setLocale("en"));
  }
});

it("shows zero for absent additive metrics in a completed report consistently with its breakdown", () => {
  state.roles = ["operations"];
  const previous = state.query.getMockImplementation()!;
  const report = {
    _id: "report-review",
    from: Date.UTC(2026, 9, 27),
    to: Date.UTC(2026, 9, 28),
    createdAt: Date.UTC(2026, 9, 29),
    completedAt: Date.UTC(2026, 9, 29),
    status: "completed",
    stageName: "finished",
    processed: 1,
    financial: false,
    taskState: null,
    metrics: { activeAccounts: 1 },
  };
  state.query.mockImplementation((name: string, args: unknown) => {
    if (name === "adminAnalytics:list")
      return { page: [report], isDone: true, continueCursor: "" };
    if (name === "adminAnalytics:detail") return report;
    if (name === "adminAnalytics:rows")
      return {
        page: [{ key: "2026-10-27", metrics: { activeAccounts: 1 } }],
        isDone: true,
        continueCursor: "",
      };
    return previous(name, args);
  });
  page("/analytics");
  const label = screen.getByText("Jobs created", { selector: "dt" });
  expect(label.parentElement?.querySelector("dd")).toHaveTextContent("0");
  expect(
    screen.getByRole("table", { name: "Report breakdown" }),
  ).toHaveTextContent("0");
});
