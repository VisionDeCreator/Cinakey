import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { getFunctionName } from "convex/server";
import { BillingSettings } from "./BillingSettings";
const state = vi.hoisted(() => ({
  billingMode: "paid",
  canManage: true,
  isOwner: true,
  enabled: false,
  action: vi.fn(),
  config: vi.fn(),
  paid: false,
  paidSeats: 2,
  workspaceId: "workspace",
  orders: [] as Array<Record<string, unknown>>,
  customerId: undefined as string | undefined,
}));
vi.mock("@/features/workspaces/workspace-context", () => ({
  useWorkspace: () => ({
    workspaceId: state.workspaceId,
    canManage: state.canManage,
  }),
}));
vi.mock("@/lib/api/hooks", () => ({
  useQuery: (ref: Parameters<typeof getFunctionName>[0]) =>
    getFunctionName(ref) === "billing:getBalance"
      ? { balance: 128500000 }
      : getFunctionName(ref) === "billing:budgets"
        ? { workspace: { reservedUsdMicros: 12000000 } }
        : {
            billingMode: state.billingMode,
            isOwner: state.isOwner,
            occupiedSeats: 1,
            usable: state.paid,
            orders: state.orders,
            includedAvailable: 5_000_000,
            purchasedAvailable: 10_000_000,
            state: state.paid
              ? {
                  status: "active",
                  subscriptionId: "sub",
                  customerId: state.customerId,
                  seats: 2,
                  paidSeats: state.paidSeats,
                  periodStart: Date.UTC(2026, 9, 1),
                  periodEnd: Date.UTC(2026, 10, 1),
                }
              : null,
          },
  useAction: (ref: Parameters<typeof getFunctionName>[0]) =>
    getFunctionName(ref) === "payments:configuration"
      ? state.config
      : state.action,
}));
beforeEach(() => {
  state.billingMode = "paid";
  state.workspaceId = "workspace";
  state.orders = [];
  state.customerId = undefined;
  state.canManage = true;
  state.isOwner = true;
  state.paid = false;
  state.paidSeats = 2;
  state.enabled = false;
  state.action.mockReset().mockResolvedValue({ scheduled: true });
  state.config.mockReset().mockImplementation(async () => ({
    enabled: state.enabled,
    environment: "sandbox",
  }));
});
afterEach(cleanup);
it("shows disabled state without purchase controls", async () => {
  render(<BillingSettings />);
  expect(
    await screen.findByText("Payments are not enabled yet."),
  ).toBeInTheDocument();
  expect(screen.queryByText("Subscribe with Polar")).not.toBeInTheDocument();
});
it("hides billing from Creators and purchasing controls from Admins", async () => {
  state.canManage = false;
  const v = render(<BillingSettings />);
  expect(screen.queryByLabelText("Workspace billing")).not.toBeInTheDocument();
  state.canManage = true;
  state.isOwner = false;
  state.enabled = true;
  v.rerender(<BillingSettings />);
  expect(
    await screen.findByText(/Only the workspace owner/),
  ).toBeInTheDocument();
  expect(screen.queryByRole("button")).not.toBeInTheDocument();
});
it("shows monthly allowance and disables top-ups before subscription payment", async () => {
  state.enabled = true;
  render(<BillingSettings />);
  expect(await screen.findByText(/Sandbox billing/)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Add $10 usage" })).toBeDisabled();
  expect(screen.getByText(/no rollover/)).toBeInTheDocument();
});
it("submits a seat decrease and shows that it is scheduled for renewal", async () => {
  state.enabled = true;
  state.paid = true;
  render(<BillingSettings />);
  await screen.findByText(/Sandbox billing/);
  fireEvent.change(screen.getByLabelText("Total paid seats, including owner"), {
    target: { value: "1" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Update seats" }));
  await waitFor(() =>
    expect(state.action).toHaveBeenCalledWith({
      workspaceId: "workspace",
      seats: 1,
    }),
  );
  expect(await screen.findByRole("status")).toHaveTextContent(
    "scheduled for renewal",
  );
});
it("reports a pending payment without claiming successful funding", async () => {
  state.enabled = true;
  state.action.mockRejectedValue(new Error("Payment is pending"));
  render(<BillingSettings />);
  await screen.findByText(/Sandbox billing/);
  fireEvent.click(screen.getByRole("button", { name: "Subscribe with Polar" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Payment is pending",
  );
  expect(screen.queryByText("Payment successful")).not.toBeInTheDocument();
});

it("shows balances and recorded refunds even when payments are disabled", async () => {
  state.orders = [
    {
      _id: "order-one",
      orderId: "polar-order-one",
      createdAt: Date.UTC(2026, 9, 27),
      kind: "topup",
      netCents: 1000,
      refundedCents: 400,
    },
  ];
  render(<BillingSettings />);
  await screen.findByText("Payments are not enabled yet.");
  expect(screen.getByText("Included usage available")).toBeInTheDocument();
  expect(
    screen.getByRole("table", { name: "Recent workspace payments" }),
  ).toHaveTextContent("Usage top-up");
  expect(screen.getByText("$4.00 refunded")).toBeInTheDocument();
  expect(screen.queryByRole("button")).not.toBeInTheDocument();
  expect(state.action).not.toHaveBeenCalled();
});
it("prevents fractional and excessive seat quantities before any payment action", async () => {
  state.enabled = true;
  render(<BillingSettings />);
  await screen.findByText(/Sandbox billing/);
  for (const value of ["0", "1.5", "101"]) {
    fireEvent.change(
      screen.getByLabelText("Total paid seats, including owner"),
      { target: { value } },
    );
    expect(
      screen.getByRole("button", { name: "Subscribe with Polar" }),
    ).toBeDisabled();
  }
  expect(state.action).not.toHaveBeenCalled();
});
it("opens the owner portal for the selected workspace and reports failures", async () => {
  state.enabled = true;
  state.paid = true;
  state.customerId = "customer";
  state.action.mockRejectedValue(new Error("Portal temporarily unavailable"));
  render(<BillingSettings />);
  await screen.findByText(/Sandbox billing/);
  fireEvent.click(
    screen.getByRole("button", { name: "Manage subscription & invoices" }),
  );
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Portal temporarily unavailable",
  );
  expect(state.action).toHaveBeenCalledWith({ workspaceId: "workspace" });
});
it("clears billing drafts and notices on workspace switches", async () => {
  state.enabled = true;
  state.paid = true;
  const view = render(<BillingSettings />);
  await screen.findByText(/Sandbox billing/);
  fireEvent.change(screen.getByLabelText("Total paid seats, including owner"), {
    target: { value: "1" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Update seats" }));
  await screen.findByRole("status");
  state.workspaceId = "second-workspace";
  view.rerender(<BillingSettings />);
  await screen.findByText(/Sandbox billing/);
  expect(
    screen.getByLabelText("Total paid seats, including owner"),
  ).toHaveValue(2);
  expect(
    screen.queryByText("Seat reduction scheduled for renewal."),
  ).not.toBeInTheDocument();
});

it("explains pending extra seat capacity without claiming it is already available", async () => {
  state.enabled = true;
  state.paid = true;
  state.paidSeats = 1;
  const view = render(<BillingSettings />);
  expect(
    await screen.findByText(
      /Waiting for payment confirmation for 1 extra seat/,
    ),
  ).toBeInTheDocument();
  expect(
    screen.getByText(/new members can join after the invoice is confirmed/),
  ).toBeInTheDocument();
  state.paidSeats = 2;
  view.rerender(<BillingSettings />);
  expect(
    screen.queryByText(/Waiting for payment confirmation for 1 extra seat/),
  ).not.toBeInTheDocument();
});

it("shows company funding and hides all purchase controls for internal workspaces", async () => {
  state.billingMode = "internal";
  state.enabled = true;
  render(<BillingSettings />);
  expect(
    await screen.findByText("Company-funded workspace"),
  ).toBeInTheDocument();
  expect(screen.getByText("Amount payable")).toBeInTheDocument();
  expect(screen.getByText("$0.00")).toBeInTheDocument();
  expect(screen.queryByText("Subscribe with Polar")).not.toBeInTheDocument();
  expect(screen.queryByText("Add $10 usage")).not.toBeInTheDocument();
  expect(
    screen.queryByText("Total paid seats, including owner"),
  ).not.toBeInTheDocument();
  expect(state.action).not.toHaveBeenCalled();
});
