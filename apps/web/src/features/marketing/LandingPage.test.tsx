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
  within,
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
  for (const link of screen.getAllByRole("link", { name: "Start free trial" }))
    expect(link).toHaveAttribute("href", "/sign-up");
  expect(
    screen.queryByText(
      "For creators and small production teams. Access is approved manually.",
    ),
  ).not.toBeInTheDocument();
});

it("opens the feature guide from pricing and restores focus after Escape", async () => {
  const user = (await import("@testing-library/user-event")).default.setup();
  render(
    <MemoryRouter>
      <LandingPage />
    </MemoryRouter>,
  );
  const pricing = document.querySelector("#pricing")!;
  const trigger = within(pricing as HTMLElement).getByRole("button", {
    name: "See all features",
  });
  await user.click(trigger);
  const dialog = screen.getByRole("dialog", {
    name: "Explore your creative workspace",
  });
  expect(
    within(dialog).getByText(/Each generation saves its script/),
  ).toBeInTheDocument();
  await user.click(
    within(dialog).getByRole("button", { name: "Share & videos" }),
  );
  expect(within(dialog).getByText("Up to 200 MiB per video")).toBeVisible();
  expect(
    within(dialog).getByText(/Workspace storage limit: 5 GiB/),
  ).toBeVisible();
  await user.keyboard("{Escape}");
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(trigger).toHaveFocus();
});

it("opens the same guide from features and closes with the close button", async () => {
  const user = (await import("@testing-library/user-event")).default.setup();
  render(
    <MemoryRouter>
      <LandingPage />
    </MemoryRouter>,
  );
  await user.click(
    screen.getByRole("button", { name: /Explore all features/ }),
  );
  await user.click(
    within(screen.getByRole("dialog")).getByRole("button", { name: "Close" }),
  );
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});

it("discloses the trial start, paid credits, expiry restrictions and indefinite retention", () => {
  render(
    <MemoryRouter>
      <LandingPage />
    </MemoryRouter>,
  );
  expect(
    screen.getByText("Try the workspace free for seven days"),
  ).toBeVisible();
  expect(
    screen.getByRole("link", { name: "How the trial works" }),
  ).toHaveAttribute("href", "#trial-details");
  const details = screen.getByRole("region", {
    name: "How the seven-day trial works",
  });
  expect(details).toHaveTextContent("Signing up does not start the clock");
  expect(details).toHaveTextContent("one creator seat");
  expect(details).toHaveTextContent("No card is required");
  expect(details).toHaveTextContent("starting at $10");
  expect(details).toHaveTextContent("No free generation credits are included");
  expect(details).toHaveTextContent("upload image/video references");
  expect(details).toHaveTextContent("purchased balance reaches zero");
  expect(details).toHaveTextContent("retained indefinitely for now");
  expect(details).toHaveTextContent("no automatic subscription charge");
  expect(details).toHaveTextContent(/\$29(?:\.00)?\/month/);
  expect(details).toHaveTextContent(/\$10(?:\.00)?\/month each/);
});
