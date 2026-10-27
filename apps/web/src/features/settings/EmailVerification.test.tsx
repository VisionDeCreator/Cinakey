import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { getFunctionName } from "convex/server";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { EmailVerification } from "./EmailVerification";
const state = vi.hoisted(() => ({
  verified: false,
  send: vi.fn(),
  verify: vi.fn(),
}));
vi.mock("@/lib/api/hooks", () => ({
  useQuery: () => ({
    email: "person@test.com",
    emailVerificationTime: state.verified ? 100 : undefined,
  }),
  useAction: (ref: Parameters<typeof getFunctionName>[0]) =>
    getFunctionName(ref) === "teamOnboarding:startVerification"
      ? state.send
      : state.verify,
}));
beforeEach(() => {
  state.verified = false;
  state.send.mockReset().mockResolvedValue({ sent: true });
  state.verify.mockReset().mockResolvedValue({ verified: true });
});
afterEach(cleanup);
it("sends a code explicitly and submits the six-digit code", async () => {
  render(<EmailVerification />);
  expect(state.send).not.toHaveBeenCalled();
  fireEvent.click(
    screen.getByRole("button", { name: "Send verification code" }),
  );
  expect(await screen.findByRole("status")).toHaveTextContent("code sent");
  fireEvent.change(screen.getByLabelText("Verification code"), {
    target: { value: "123456" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Verify email" }));
  await waitFor(() =>
    expect(state.verify).toHaveBeenCalledWith({ code: "123456" }),
  );
});
it("reports unavailable email delivery without claiming success", async () => {
  state.send.mockRejectedValue(new Error("Email delivery is not configured"));
  render(<EmailVerification />);
  fireEvent.click(
    screen.getByRole("button", { name: "Send verification code" }),
  );
  expect(await screen.findByRole("alert")).toHaveTextContent("not configured");
  expect(screen.queryByRole("status")).toBeNull();
});
it("does not offer verification to an already verified account", () => {
  state.verified = true;
  render(<EmailVerification />);
  expect(
    screen.getByText("Email verified: person@test.com"),
  ).toBeInTheDocument();
  expect(screen.queryByRole("button")).toBeNull();
});
