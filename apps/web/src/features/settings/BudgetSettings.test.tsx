import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { BudgetSettings } from "./BudgetSettings";

const state = vi.hoisted(() => ({ canManage: true, save: vi.fn() }));
vi.mock("@/features/workspaces/workspace-context", () => ({
  useWorkspace: () => ({
    workspaceId: "workspace",
    canManage: state.canManage,
  }),
}));
vi.mock("@/lib/api/hooks", () => ({
  useQuery: () => ({
    month: "2026-10",
    workspace: {
      spentUsdMicros: 7_000_000,
      reservedUsdMicros: 3_000_000,
      spendCapUsdMicros: 20_000_000,
      remaining: 10_000_000,
    },
    series: [],
    projects: [],
  }),
  useMutation: () => state.save,
}));
beforeEach(() => {
  state.canManage = true;
  state.save.mockReset().mockResolvedValue(null);
});
afterEach(cleanup);

it("shows spent and reserved separately, saves a zero cap and removes a cap with blank input", async () => {
  render(<BudgetSettings />);
  expect(
    screen.getByText("Spent: $7.00 · Reserved: $3.00 · Remaining: $10.00"),
  ).toBeInTheDocument();
  const input = screen.getByLabelText(/Workspace.*USD cap/);
  fireEvent.change(input, { target: { value: "0" } });
  fireEvent.click(screen.getByRole("button", { name: "Save cap" }));
  await waitFor(() =>
    expect(state.save).toHaveBeenCalledWith({
      workspaceId: "workspace",
      cap: 0,
    }),
  );
  await screen.findByRole("status");
  fireEvent.change(input, { target: { value: "" } });
  fireEvent.click(screen.getByRole("button", { name: "Save cap" }));
  await waitFor(() =>
    expect(state.save).toHaveBeenLastCalledWith({
      workspaceId: "workspace",
      cap: null,
    }),
  );
});
it("rejects amounts with more than six decimal places", () => {
  render(<BudgetSettings />);
  fireEvent.change(screen.getByLabelText(/USD cap/), {
    target: { value: "1.0000001" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save cap" }));
  expect(screen.getByRole("alert")).toHaveTextContent("USD amount");
  expect(state.save).not.toHaveBeenCalled();
});
it("accepts decimal dollars and submits integer micro-USD", async () => {
  render(<BudgetSettings />);
  fireEvent.change(screen.getByLabelText(/USD cap/), {
    target: { value: "1.29" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save cap" }));
  await waitFor(() =>
    expect(state.save).toHaveBeenCalledWith({
      workspaceId: "workspace",
      cap: 1_290_000,
    }),
  );
});
it("hides workspace financial controls for Creators", () => {
  state.canManage = false;
  const { container } = render(<BudgetSettings />);
  expect(container).toBeEmptyDOMElement();
});
