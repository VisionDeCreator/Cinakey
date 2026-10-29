import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import type { Doc } from "@dirrio/backend";
import { getFunctionName } from "convex/server";
import { ProjectSettings } from "./ProjectSettings";
const state = vi.hoisted(() => ({ assign: vi.fn(), queries: vi.fn() }));
vi.mock("@/lib/api/hooks", () => ({
  useQuery: (ref: Parameters<typeof getFunctionName>[0], args: unknown) => {
    const name = getFunctionName(ref);
    state.queries(name, args);
    if (name === "teams:projectAccess")
      return [
        {
          userId: "owner",
          email: "owner@test.com",
          role: "owner",
          automatic: true,
          direct: false,
          inherited: false,
        },
        {
          userId: "creator",
          email: "creator@test.com",
          role: "creator",
          automatic: false,
          direct: false,
          inherited: true,
        },
      ];
    return { remaining: null };
  },
  useMutation: () => state.assign,
}));
const project = {
  _id: "project",
  workspaceId: "workspace",
  title: "Film",
  aspectRatio: "16:9",
  fps: 24,
} as unknown as Doc<"projects">;
beforeEach(() => {
  state.assign.mockReset().mockResolvedValue(undefined);
  state.queries.mockClear();
});
afterEach(cleanup);
function open() {
  render(
    <MemoryRouter>
      <ProjectSettings project={project} />
    </MemoryRouter>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Settings & budgets" }));
  fireEvent.click(screen.getByRole("button", { name: "Project access" }));
}
it("offers only this project's direct grants and labels automatic and inherited access", async () => {
  open();
  expect(screen.getByText("Automatic access")).toBeInTheDocument();
  expect(screen.getByText(/Access through series/)).toBeInTheDocument();
  expect(screen.queryByText("Invite by email")).not.toBeInTheDocument();
  expect(screen.queryByText("Transfer ownership")).not.toBeInTheDocument();
  expect(
    state.queries.mock.calls.some(([name]) => name === "teams:members"),
  ).toBe(false);
  expect(
    screen.getByRole("link", { name: "Manage workspace team" }),
  ).toHaveAttribute("href", "/billing#members");
  fireEvent.click(
    screen.getByRole("checkbox", {
      name: "Direct project access for creator@test.com",
    }),
  );
  await waitFor(() =>
    expect(state.assign).toHaveBeenCalledWith({
      workspaceId: "workspace",
      projectId: "project",
      userId: "creator",
      enabled: true,
    }),
  );
});
it("reports a denied grant without pretending access was saved", async () => {
  state.assign.mockRejectedValue(new Error("Access denied"));
  open();
  const checkbox = screen.getByRole("checkbox", {
    name: "Direct project access for creator@test.com",
  });
  fireEvent.click(checkbox);
  expect(await screen.findByRole("alert")).toHaveTextContent("Access denied");
  expect(checkbox).not.toBeChecked();
});
