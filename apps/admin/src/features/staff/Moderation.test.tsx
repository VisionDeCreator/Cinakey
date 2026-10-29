import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { getFunctionName } from "convex/server";
import { ModerationPage } from "../../Media";
const state = vi.hoisted(() => ({
  queue: undefined as
    | undefined
    | {
        page: Array<{
          _id: string;
          verdict: string;
          stage: string;
          ruleId: string;
          status: string;
          revision: number;
          createdAt: number;
          userId: string;
        }>;
        isDone: boolean;
        continueCursor: string;
      },
  mutation: vi.fn(),
}));
vi.mock("@dirrio/api-client", () => ({
  useQuery: (ref: Parameters<typeof getFunctionName>[0]) =>
    getFunctionName(ref) === "users:viewer"
      ? { _id: "moderator-1", isStaff: true, adminRoles: ["moderation"] }
      : state.queue,
  useMutation: () => state.mutation,
  useAction: () => state.mutation,
}));
afterEach(cleanup);
beforeEach(() => {
  state.queue = {
    page: [
      {
        _id: "flag-1",
        userId: "user-1",
        verdict: "flagged",
        stage: "prompt",
        ruleId: "rule-1",
        status: "open",
        revision: 0,
        createdAt: Date.now(),
      },
    ],
    isDone: true,
    continueCursor: "",
  };
  state.mutation.mockReset().mockResolvedValue(null);
});
function view() {
  return render(
    <MemoryRouter>
      <ModerationPage />
    </MemoryRouter>,
  );
}
it("shows loading and empty queue states without invented flags", () => {
  state.queue = undefined;
  const rendered = view();
  expect(screen.getByRole("status")).toHaveTextContent(
    "Loading moderation queue",
  );
  state.queue = { page: [], isDone: true, continueCursor: "" };
  rendered.rerender(
    <MemoryRouter>
      <ModerationPage />
    </MemoryRouter>,
  );
  expect(
    screen.getByText("No matching moderation flags on this page."),
  ).toBeInTheDocument();
});
it("requires an explicit reason and records the selected decision with its revision", async () => {
  view();
  fireEvent.change(screen.getByLabelText("Moderation decision"), {
    target: { value: "dismissed" },
  });
  fireEvent.change(screen.getByLabelText("Record moderation decision reason"), {
    target: { value: "Reviewed full customer context" },
  });
  fireEvent.click(
    screen.getByRole("button", { name: "Record moderation decision" }),
  );
  await waitFor(() =>
    expect(state.mutation).toHaveBeenCalledWith(
      expect.objectContaining({
        flagId: "flag-1",
        status: "dismissed",
        expectedRevision: 0,
        reason: "Reviewed full customer context",
        assignedTo: null,
        requestId: expect.any(String),
      }),
    ),
  );
});
it("preserves the same request ID for an unchanged failed action retry", async () => {
  state.mutation.mockRejectedValueOnce(new Error("Temporary failure"));
  view();
  fireEvent.change(screen.getByLabelText("Record moderation decision reason"), {
    target: { value: "Investigated provider policy result" },
  });
  fireEvent.click(
    screen.getByRole("button", { name: "Record moderation decision" }),
  );
  expect(await screen.findByText("Temporary failure")).toBeInTheDocument();
  fireEvent.click(
    screen.getByRole("button", { name: "Record moderation decision" }),
  );
  await waitFor(() => expect(state.mutation).toHaveBeenCalledTimes(2));
  expect(state.mutation.mock.calls[0]?.[0].requestId).toBe(
    state.mutation.mock.calls[1]?.[0].requestId,
  );
});
it("does not expose private prompt evidence until an audited read is requested", async () => {
  state.mutation.mockResolvedValue({
    prompt: "Private flagged prompt",
    asset: null,
  });
  view();
  expect(screen.queryByText("Private flagged prompt")).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("Read moderation evidence reason"), {
    target: { value: "Inspect this reported policy violation" },
  });
  fireEvent.click(
    screen.getByRole("button", { name: "Read moderation evidence" }),
  );
  expect(await screen.findByText("Private flagged prompt")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Hide evidence" }));
  expect(screen.queryByText("Private flagged prompt")).not.toBeInTheDocument();
});
