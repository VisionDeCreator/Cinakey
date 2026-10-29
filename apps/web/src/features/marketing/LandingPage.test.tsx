const policy = vi.hoisted(() => ({ required: true }));
vi.mock("../auth/useRegistrationPolicy", () => ({
  useRegistrationPolicy: () => policy.required,
}));
import { setLocale, t } from "@dirrio/ui/i18n";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import { LandingPage } from "./LandingPage";
vi.mock("@/lib/api/hooks", () => ({
  useConvexAuth: () => ({ isAuthenticated: false }),
}));
afterEach(() => {
  policy.required = true;
  cleanup();
  vi.unstubAllGlobals();
});
it("shows public content, pricing, and existing-user sign in", () => {
  render(
    <MemoryRouter>
      <LandingPage />
    </MemoryRouter>,
  );
  expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
    "Your story",
  );
  expect(screen.getAllByRole("link", { name: "Sign in" })[0]).toHaveAttribute(
    "href",
    "/sign-in",
  );
  expect(
    screen.getByRole("heading", { name: "3D staging" }),
  ).toBeInTheDocument();
  expect(
    screen.getByRole("heading", { name: "Additional seats" }),
  ).toBeInTheDocument();
});
it("only confirms a waitlist request after server success and permits retry", async () => {
  const request = vi
    .fn()
    .mockResolvedValueOnce({ ok: false, status: 503 })
    .mockResolvedValueOnce({ ok: true });
  vi.stubGlobal("fetch", request);
  render(
    <MemoryRouter>
      <LandingPage />
    </MemoryRouter>,
  );
  fireEvent.change(screen.getByLabelText("Email"), {
    target: { value: "creator@example.com" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Request early access" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("couldn’t save");
  fireEvent.click(screen.getByRole("button", { name: "Request early access" }));
  await waitFor(() =>
    expect(screen.getByRole("status")).toHaveTextContent(
      "Your request is received",
    ),
  );
  expect(request).toHaveBeenCalledTimes(2);
  expect(JSON.parse(request.mock.calls[1]![1].body)).toMatchObject({
    email: "creator@example.com",
  });
});

it("localizes landing copy and form labels while preserving an unsubmitted draft", () => {
  render(
    <MemoryRouter>
      <LandingPage />
    </MemoryRouter>,
  );
  fireEvent.change(screen.getByRole("textbox", { name: /^Name/ }), {
    target: { value: "Unsaved landing draft" },
  });
  act(() => setLocale("fr"));
  try {
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      t("Your story. One creative workspace."),
    );
    expect(screen.getByRole("textbox", { name: /^Nom/ })).toHaveValue(
      "Unsaved landing draft",
    );
    expect(
      screen.getByRole("button", { name: t("Request early access") }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("combobox", { name: t("Language") }),
    ).toBeInTheDocument();
  } finally {
    act(() => setLocale("en"));
  }
});

it("replaces the waitlist and manual-approval copy with direct signup when registration is open", () => {
  policy.required = false;
  setLocale("en");
  render(
    <MemoryRouter>
      <LandingPage />
    </MemoryRouter>,
  );
  expect(screen.getByText("OPEN REGISTRATION")).toBeInTheDocument();
  expect(screen.queryByLabelText("Email")).not.toBeInTheDocument();
  expect(
    screen.queryByText("INVITE-ONLY EARLY ACCESS"),
  ).not.toBeInTheDocument();
  for (const link of screen.getAllByRole("link", { name: "Create account" }))
    expect(link).toHaveAttribute("href", "/sign-up");
  expect(
    screen.queryByText(
      "For creators and small production teams. Access is approved manually.",
    ),
  ).not.toBeInTheDocument();
});
