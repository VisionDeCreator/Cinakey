import { setLocale, t } from "@dirrio/ui/i18n";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { SignIn } from "./SignIn";
const state = vi.hoisted(() => ({ request: vi.fn(), signIn: vi.fn() }));
vi.mock("@dirrio/api-client", () => ({
  useConvexAuth: () => ({ isAuthenticated: false, isLoading: false }),
}));
vi.mock("@convex-dev/auth/react", () => ({
  useAuthActions: () => ({ signIn: state.signIn }),
}));
vi.mock("@dirrio/api-client/email-otp", async (original) => ({
  ...(await original<typeof import("@dirrio/api-client/email-otp")>()),
  requestEmailCode: state.request,
}));
beforeEach(() => {
  sessionStorage.clear();
  state.request.mockReset().mockResolvedValue({
    email: "owner@test.com",
    challenge: "a".repeat(64),
    expiresAt: Date.now() + 600_000,
    resendAt: Date.now() + 60_000,
  });
  state.signIn.mockReset().mockResolvedValue({ signingIn: true });
});
afterEach(() => {
  cleanup();
  setLocale("en");
  sessionStorage.clear();
});
it("uses the shared email challenge flow and preserves leading-zero verification codes", async () => {
  render(
    <MemoryRouter>
      <SignIn />
    </MemoryRouter>,
  );
  fireEvent.change(screen.getByLabelText("Email"), {
    target: { value: "Owner@Test.com" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Send sign-in code" }));
  await screen.findByLabelText("Verification code");
  expect(state.request).toHaveBeenCalledWith(
    "owner@test.com",
    expect.any(AbortSignal),
  );
  expect(state.signIn).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText("Verification code"), {
    target: { value: "001234" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Verify and sign in" }));
  await waitFor(() =>
    expect(state.signIn).toHaveBeenCalledWith("email-otp", {
      email: "owner@test.com",
      challenge: "a".repeat(64),
      code: "001234",
    }),
  );
  await waitFor(() =>
    expect(sessionStorage.getItem("dirrio.email-login.v1")).toBeNull(),
  );
});
it("shows verification failures without granting access or clearing a retryable challenge", async () => {
  state.signIn.mockRejectedValue(new Error("Could not verify code"));
  render(
    <MemoryRouter>
      <SignIn />
    </MemoryRouter>,
  );
  fireEvent.change(screen.getByLabelText("Email"), {
    target: { value: "owner@test.com" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Send sign-in code" }));
  await screen.findByLabelText("Verification code");
  fireEvent.change(screen.getByLabelText("Verification code"), {
    target: { value: "123456" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Verify and sign in" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "That code is incorrect or has expired",
  );
  expect(sessionStorage.getItem("dirrio.email-login.v1")).not.toBeNull();
});

it("switches admin sign-in language without clearing the email field", () => {
  render(
    <MemoryRouter>
      <SignIn />
    </MemoryRouter>,
  );
  const email = screen.getByLabelText("Email");
  fireEvent.change(email, { target: { value: "owner@example.com" } });
  Element.prototype.scrollIntoView = vi.fn();
  fireEvent.keyDown(screen.getByRole("combobox"), { key: "ArrowDown" });
  fireEvent.click(screen.getByRole("option", { name: "Français" }));
  expect(
    screen.getByRole("heading", { name: t("Admin sign in") }),
  ).toBeInTheDocument();
  expect(screen.getByLabelText(t("Email"))).toBe(email);
  expect(email).toHaveValue("owner@example.com");
});
