import { setLocale } from "@dirrio/ui/i18n";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  act,
  cleanup,
} from "@testing-library/react";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { getFunctionName } from "convex/server";
import { WaitlistPage } from "./Waitlist";
const fixture = vi.hoisted(() => ({
  second: false,
  registered: false,
  status: "pending",
}));
beforeEach(() => {
  fixture.second = false;
  fixture.registered = false;
  fixture.status = "pending";
  review.mockClear();
});
afterEach(cleanup);
const review = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
vi.mock("@dirrio/api-client", () => ({
  useMutation: () => review,
  useQueryStatus: () => ({ retry: vi.fn() }),
  useQuery: (ref: never) => {
    const name = getFunctionName(ref);
    if (name === "users:viewer") return { isStaff: true };
    if (name === "earlyAccess:settings")
      return { requireApproval: true, revision: 0 };
    if (name === "earlyAccess:counts")
      return { total: 1, pending: 1, approved: 0, rejected: 0, registered: 0 };
    return {
      page: [
        {
          _id: "fixture",
          email: "creator@example.com",
          name: "Creator",
          idea: "A film",
          status: fixture.registered ? "approved" : fixture.status,
          registeredUserId: fixture.registered ? "registered-user" : undefined,
          createdAt: 0,
        },
        ...(fixture.second
          ? [
              {
                _id: "second",
                email: "second@example.com",
                name: "Second",
                idea: "Another film",
                status: "pending",
                createdAt: 0,
              },
            ]
          : []),
      ],
      isDone: true,
      continueCursor: "",
    };
  },
}));
it("approves immediately without a review reason", async () => {
  render(<WaitlistPage />);
  fireEvent.click(screen.getByRole("button", { name: "Approve" }));
  await waitFor(() =>
    expect(review).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "fixture",
        status: "approved",
        reason: "",
      }),
    ),
  );
  expect(await screen.findByText("Waitlist updated.")).toBeInTheDocument();
  act(() => setLocale("fr"));
  expect(screen.getByText("Liste d’attente mise à jour.")).toBeInTheDocument();
  act(() => setLocale("en"));
});

it("does not carry a review reason over to another applicant", async () => {
  fixture.second = true;
  render(<WaitlistPage />);
  fireEvent.change(screen.getByLabelText("Review reason (optional)"), {
    target: { value: "This reason belongs only to the first applicant" },
  });
  expect(screen.getByRole("button", { name: "Approve" })).toBeEnabled();
  fireEvent.click(
    screen.getByRole("button", { name: "Review second@example.com" }),
  );
  expect(screen.getByText("Another film")).toBeInTheDocument();
  expect(screen.getByLabelText("Review reason (optional)")).toHaveValue("");
  fireEvent.click(screen.getByRole("button", { name: "Approve" }));
  await waitFor(() =>
    expect(review).toHaveBeenCalledWith(
      expect.objectContaining({ id: "second", status: "approved", reason: "" }),
    ),
  );
});

it("resends without a reason while keeping registered applicants protected", async () => {
  fixture.registered = true;
  render(<WaitlistPage />);
  expect(screen.getByRole("button", { name: "Reject" })).toBeDisabled();
  expect(
    screen.getByRole("button", { name: "Return to pending" }),
  ).toBeDisabled();
  fireEvent.click(
    screen.getByRole("button", { name: "Resend approval email" }),
  );
  await waitFor(() =>
    expect(review).toHaveBeenCalledWith(
      expect.objectContaining({ status: "approved", resend: true, reason: "" }),
    ),
  );
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});

it.each([
  ["Reject", "pending", "rejected"],
  ["Return to pending", "rejected", "pending"],
])("%s works without a review reason", async (action, current, status) => {
  fixture.status = current;
  render(<WaitlistPage />);
  fireEvent.click(screen.getByRole("button", { name: action }));
  await waitFor(() =>
    expect(review).toHaveBeenCalledWith(
      expect.objectContaining({ status, reason: "" }),
    ),
  );
});
it("accepts an optional short note", async () => {
  render(<WaitlistPage />);
  fireEvent.change(screen.getByLabelText("Review reason (optional)"), {
    target: { value: "OK" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Approve" }));
  await waitFor(() =>
    expect(review).toHaveBeenCalledWith(
      expect.objectContaining({ status: "approved", reason: "OK" }),
    ),
  );
});
