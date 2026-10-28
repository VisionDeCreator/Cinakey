import userEvent from "@testing-library/user-event";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { getFunctionName } from "convex/server";
import { StoredExports } from "./StoredExports";
const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  revoke: vi.fn(),
  remove: vi.fn(),
}));
vi.mock("@/lib/api/context", () => ({
  useClient: () => ({ token: "fixture", baseUrl: "http://localhost" }),
}));
vi.mock("@/components/use-confirm", () => ({
  useConfirm: () => vi.fn().mockResolvedValue(false),
}));
vi.mock("@/lib/api/hooks", () => ({
  useAction: () => mocks.create,
  useMutation: (ref: Parameters<typeof getFunctionName>[0]) =>
    getFunctionName(ref) === "exportSharing:revoke"
      ? mocks.revoke
      : mocks.remove,
  useQuery: (ref: Parameters<typeof getFunctionName>[0], args: unknown) =>
    args === "skip"
      ? undefined
      : getFunctionName(ref) === "publishedExports:list"
        ? [
            {
              _id: "publication",
              state: "ready",
              title: "Film",
              sizeBytes: 1024,
              createdAt: 1,
            },
          ]
        : [
            {
              _id: "link",
              passwordProtected: true,
              allowDownload: false,
              createdAt: 1,
            },
          ],
}));
beforeEach(() => {
  vi.clearAllMocks();
  HTMLElement.prototype.scrollIntoView = vi.fn();
  HTMLElement.prototype.hasPointerCapture = vi.fn(() => false);
  HTMLElement.prototype.setPointerCapture = vi.fn();
  HTMLElement.prototype.releasePointerCapture = vi.fn();
  mocks.create.mockResolvedValue({
    url: "https://cinakey.test/share/link#private-secret",
  });
  mocks.revoke.mockResolvedValue(null);
});
afterEach(cleanup);
it("defaults to watch-only links with an expiry and reveals a new link for copying", async () => {
  render(<StoredExports projectId="project" />);
  fireEvent.click(screen.getByRole("button", { name: "Share & videos" }));
  fireEvent.click(screen.getByRole("button", { name: "Share" }));
  expect(
    screen.getByRole("checkbox", { name: "Allow download" }),
  ).not.toBeChecked();
  fireEvent.click(screen.getByRole("button", { name: "Create private link" }));
  await waitFor(() =>
    expect(screen.getByLabelText("New private share link")).toHaveValue(
      "https://cinakey.test/share/link#private-secret",
    ),
  );
  expect(mocks.create).toHaveBeenCalledWith(
    expect.objectContaining({
      publicationId: "publication",
      allowDownload: false,
      expiresAt: expect.any(Number),
      password: undefined,
    }),
  );
});
it("revokes links through the authorized mutation", async () => {
  render(<StoredExports projectId="project" />);
  fireEvent.click(screen.getByRole("button", { name: "Share & videos" }));
  fireEvent.click(screen.getByRole("button", { name: "Share" }));
  fireEvent.click(screen.getByRole("button", { name: "Revoke" }));
  await waitFor(() =>
    expect(mocks.revoke).toHaveBeenCalledWith({ linkId: "link" }),
  );
});

it("keeps expiry, password, and download choices when creating a viewing link", async () => {
  const user = userEvent.setup();
  render(<StoredExports projectId="project" />);
  await user.click(screen.getByRole("button", { name: "Share & videos" }));
  await user.click(screen.getByRole("button", { name: "Share" }));
  await user.click(screen.getByRole("combobox", { name: "Expires" }));
  await user.click(screen.getByRole("option", { name: "Never" }));
  await user.type(screen.getByLabelText("Optional password"), "test-password");
  await user.click(screen.getByRole("checkbox", { name: "Allow download" }));
  await user.click(screen.getByRole("button", { name: "Create private link" }));
  await waitFor(() =>
    expect(mocks.create).toHaveBeenCalledWith({
      publicationId: "publication",
      password: "test-password",
      allowDownload: true,
      expiresAt: undefined,
    }),
  );
});
