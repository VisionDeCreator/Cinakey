import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { SignInPage } from "./SignInPage";
import { SignUpPage } from "./SignUpPage";
import { authDestination } from "./auth-errors";
import { persistChallenge } from "./email-otp";
const state = vi.hoisted(() => ({ signIn: vi.fn(), request: vi.fn() }));
vi.mock("@convex-dev/auth/react", () => ({
  useAuthActions: () => ({ signIn: state.signIn }),
}));
vi.mock("./email-otp", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./email-otp")>()),
  requestEmailCode: state.request,
}));
const challenge = () => ({
  email: "person@test.com",
  challenge: "a".repeat(64),
  expiresAt: Date.now() + 600_000,
  resendAt: Date.now() + 60_000,
});
beforeEach(() => {
  sessionStorage.clear();
  state.request.mockImplementation(async () => challenge());
  state.signIn.mockResolvedValue({ signingIn: true });
});
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
  vi.useRealTimers();
  sessionStorage.clear();
});
function page(signUp = false) {
  render(
    <MemoryRouter initialEntries={["/sign-in?next=%2Fsettings"]}>
      <Routes>
        <Route
          path="/sign-in"
          element={signUp ? <SignUpPage /> : <SignInPage />}
        />
        <Route path="/settings" element={<p>Team settings destination</p>} />
      </Routes>
    </MemoryRouter>,
  );
}
async function request() {
  fireEvent.change(screen.getByLabelText("Email"), {
    target: { value: "Person@Test.com" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Continue with email" }));
  await screen.findByLabelText("Verification code");
}
it("requests a code without password or premature session; verifies leading-zero codes and returns to invitation", async () => {
  page();
  expect(screen.queryByLabelText(/Password/)).toBeNull();
  await request();
  expect(state.request).toHaveBeenCalledWith(
    "person@test.com",
    expect.any(AbortSignal),
  );
  expect(state.signIn).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText("Verification code"), {
    target: { value: "004921" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Verify and continue" }));
  await screen.findByText("Team settings destination");
  expect(state.signIn).toHaveBeenCalledWith("email-otp", {
    email: "person@test.com",
    challenge: "a".repeat(64),
    code: "004921",
  });
  expect(sessionStorage.getItem("cinakey.email-login.v1")).toBeNull();
});
it("uses the same passwordless signup flow and keeps Google sign-in", async () => {
  page(true);
  expect(screen.getByText("Create your account")).toBeInTheDocument();
  expect(screen.queryByLabelText(/Password/)).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Continue with Google" }));
  await waitFor(() =>
    expect(state.signIn).toHaveBeenCalledWith("google", {
      redirectTo: "/settings",
    }),
  );
});
it("shows safe incorrect-code feedback and lets the user retry", async () => {
  state.signIn.mockRejectedValue(
    new Error("Code is incorrect or expired. secret implementation"),
  );
  page();
  await request();
  fireEvent.change(screen.getByLabelText("Verification code"), {
    target: { value: "123456" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Verify and continue" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    /incorrect|expired/,
  );
  expect(screen.getByRole("alert")).not.toHaveTextContent("secret");
  expect(
    screen.getByRole("button", { name: "Verify and continue" }),
  ).toBeEnabled();
});
it("restores the challenge after reload, enforces resend cooldown and disables expired codes", async () => {
  vi.useFakeTimers();
  const c = challenge();
  persistChallenge(c);
  page();
  expect(screen.getByLabelText("Verification code")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Resend in 60s" })).toBeDisabled();
  await act(async () => {
    vi.advanceTimersByTime(61_000);
  });
  fireEvent.click(screen.getByRole("button", { name: "Resend code" }));
  await act(async () => {});
  expect(state.request).toHaveBeenCalledOnce();
  await act(async () => {
    vi.advanceTimersByTime(600_001);
  });
  expect(screen.getByLabelText("Verification code")).toBeDisabled();
  expect(screen.getByText(/This code has expired/)).toBeInTheDocument();
});
it("can change the destination email and never leaks delivery errors", async () => {
  page();
  await request();
  fireEvent.click(screen.getByRole("button", { name: "Change email" }));
  expect(screen.getByLabelText("Email")).toBeInTheDocument();
  expect(sessionStorage.getItem("cinakey.email-login.v1")).toBeNull();
  state.request.mockRejectedValue(new Error("SMTP_PASSWORD=secret"));
  fireEvent.click(screen.getByRole("button", { name: "Continue with email" }));
  expect(await screen.findByRole("alert")).not.toHaveTextContent(
    "SMTP_PASSWORD",
  );
});
it("rejects external and recursive authentication destinations", () => {
  for (const value of [
    "https://example.test",
    "//example.test",
    "/\\example.test",
    "/sign-in?next=/settings",
    "/sign-up",
  ])
    expect(authDestination(value)).toBe("/projects");
  expect(authDestination("/settings")).toBe("/settings");
});
