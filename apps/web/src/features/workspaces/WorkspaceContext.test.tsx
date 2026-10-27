import { useState } from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { getFunctionName } from "convex/server";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Id } from "@cinakey/backend";
import { ConfirmContext } from "@/components/use-confirm";
import { NewProjectDialog } from "@/features/projects/NewProjectDialog";
import { WorkspaceProvider } from "./WorkspaceContext";
import {
  WorkspaceContext,
  useWorkspace,
  useDraftScope,
} from "./workspace-context";

const state = vi.hoisted(() => ({
  entitlement: {
    canWrite: true,
    validUntil: null as number | null,
    message: null as string | null,
  },
  userId: "user-one",
  personalId: "one",
  secondId: "two",
  role: "creator",
  routeWorkspace: null as string | null,
  confirm: vi.fn(),
  write: vi.fn(),
}));
vi.mock("@/lib/api/hooks", () => ({
  useQuery: (ref: Parameters<typeof getFunctionName>[0], args: unknown) => {
    if (args === "skip") return undefined;
    switch (getFunctionName(ref)) {
      case "users:viewer":
        return { _id: state.userId, personalWorkspaceId: state.personalId };
      case "teams:list":
        return [
          {
            workspace: { _id: state.personalId, name: "Personal" },
            role: "owner",
          },
          {
            workspace: { _id: state.secondId, name: "Studio" },
            role: state.role,
          },
        ];
      case "payments:entitlements":
        return state.entitlement;
      case "teams:routeWorkspace":
        return state.routeWorkspace;
      default:
        return [];
    }
  },
  useMutation:
    (ref: Parameters<typeof getFunctionName>[0]) => (args: unknown) =>
      state.write(getFunctionName(ref), args),
}));
beforeEach(() => {
  state.entitlement = { canWrite: true, validUntil: null, message: null };
  state.userId = "user-one";
  state.personalId = "one";
  state.secondId = "two";
  state.role = "creator";
  state.routeWorkspace = null;
  state.confirm.mockReset().mockResolvedValue(true);
  state.write.mockReset().mockResolvedValue("created");
  const items = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => items.set(key, value),
    removeItem: (key: string) => items.delete(key),
  });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function Probe() {
  const workspace = useWorkspace();
  const draftScope = useDraftScope();
  const location = useLocation();
  const [draft, setDraft] = useState("");
  return (
    <>
      <p data-testid="draft-scope">{draftScope}</p>
      <p data-testid="active">{workspace.workspaceId}</p>
      <p data-testid="rights">
        {String(workspace.canCreate)}:{String(workspace.canManage)}
      </p>
      <p data-testid="path">{location.pathname}</p>
      <input
        aria-label="Local draft"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
      />
      <button
        onClick={() =>
          void workspace.switchWorkspace(state.secondId as Id<"workspaces">)
        }
      >
        Switch
      </button>
    </>
  );
}
function view(path = "/projects") {
  return (
    <MemoryRouter initialEntries={[path]}>
      <ConfirmContext.Provider value={state.confirm}>
        <WorkspaceProvider>
          <Probe />
        </WorkspaceProvider>
      </ConfirmContext.Provider>
    </MemoryRouter>
  );
}

it("isolates workspace selection per account and ignores invalid stored memberships", () => {
  localStorage.setItem("cinakey.workspace:another-user", "two");
  localStorage.setItem("cinakey.workspace:user-one", "not-a-member");
  render(view());
  expect(screen.getByTestId("active")).toHaveTextContent("one");
});
it("switches scope, persists it, and resets the previous workspace's component state", async () => {
  render(view());
  fireEvent.change(screen.getByLabelText("Local draft"), {
    target: { value: "Old workspace" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Switch" }));
  await waitFor(() =>
    expect(screen.getByTestId("active")).toHaveTextContent("two"),
  );
  expect(screen.getByLabelText("Local draft")).toHaveValue("");
  expect(localStorage.getItem("cinakey.workspace:user-one")).toBe("two");
  expect(screen.getByTestId("rights")).toHaveTextContent("true:false");
  expect(screen.getByTestId("draft-scope")).toHaveTextContent("user-one.two.");
});
it("uses the opened production's workspace rather than a stale saved selection", () => {
  state.routeWorkspace = "two";
  render(view("/projects/project-two/studio"));
  expect(screen.getByTestId("active")).toHaveTextContent("two");
});
it("keeps the production and draft open when workspace switching is canceled", async () => {
  state.confirm.mockResolvedValue(false);
  render(view("/projects/project-one/studio"));
  fireEvent.change(screen.getByLabelText("Local draft"), {
    target: { value: "Keep this" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Switch" }));
  await waitFor(() => expect(state.confirm).toHaveBeenCalled());
  expect(screen.getByTestId("path")).toHaveTextContent(
    "/projects/project-one/studio",
  );
  expect(screen.getByLabelText("Local draft")).toHaveValue("Keep this");
});
it("hides creation and financial administration for a reviewer workspace", () => {
  localStorage.setItem("cinakey.workspace:user-one", "two");
  state.role = "reviewer";
  render(view());
  expect(screen.getByTestId("rights")).toHaveTextContent("false:false");
});
it("does not carry another signed-in user's in-memory selection forward", async () => {
  const v = render(view());
  fireEvent.click(screen.getByRole("button", { name: "Switch" }));
  await waitFor(() =>
    expect(screen.getByTestId("active")).toHaveTextContent("two"),
  );
  state.userId = "user-next";
  state.personalId = "three";
  state.secondId = "four";
  v.rerender(view());
  expect(screen.getByTestId("active")).toHaveTextContent("three");
});
it("creates a new project in the selected workspace", async () => {
  render(
    <MemoryRouter>
      <WorkspaceContext.Provider
        value={{
          workspaceId: "two" as Id<"workspaces">,
          role: "creator",
          canCreate: true,
          canManage: false,
          workspaces: [],
          switchWorkspace: async () => {},
        }}
      >
        <NewProjectDialog open onOpenChange={vi.fn()} />
      </WorkspaceContext.Provider>
    </MemoryRouter>,
  );
  fireEvent.change(screen.getByLabelText("Name"), {
    target: { value: "Client video" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Create" }));
  await waitFor(() =>
    expect(state.write).toHaveBeenCalledWith("projects:create", {
      workspaceId: "two",
      title: "Client video",
      aspectRatio: "16:9",
      fps: 24,
    }),
  );
});
it("expires write access at the paid deadline and restores it without discarding local work", async () => {
  vi.useFakeTimers();
  state.entitlement = {
    canWrite: true,
    validUntil: Date.now() + 500,
    message: null,
  };
  const rendered = render(view());
  fireEvent.change(screen.getByLabelText("Local draft"), {
    target: { value: "Keep this draft" },
  });
  expect(screen.getByTestId("rights")).toHaveTextContent("true:true");
  await act(async () => {
    await vi.advanceTimersByTimeAsync(501);
  });
  expect(screen.getByTestId("rights")).toHaveTextContent("false:true");
  expect(screen.getByLabelText("Local draft")).toHaveValue("Keep this draft");
  state.entitlement = {
    canWrite: true,
    validUntil: Date.now() + 10_000,
    message: null,
  };
  rendered.rerender(view());
  expect(screen.getByTestId("rights")).toHaveTextContent("true:true");
  expect(screen.getByLabelText("Local draft")).toHaveValue("Keep this draft");
});

it("binds billing returns to their workspace despite a different saved selection", () => {
  localStorage.setItem("cinakey.workspace:user-one", "one");
  render(view("/billing/two?billing=returned"));
  expect(screen.getByTestId("active")).toHaveTextContent("two");
  expect(screen.getByTestId("rights")).toHaveTextContent("true:false");
});
it("does not fall back to another workspace for an inaccessible billing return", () => {
  render(view("/billing/not-a-member?billing=returned"));
  expect(screen.getByRole("alert")).toHaveTextContent(
    "billing workspace is unavailable",
  );
  expect(screen.queryByTestId("active")).not.toBeInTheDocument();
});
it("keeps the billing page open when switching workspaces", async () => {
  render(view("/billing/one"));
  fireEvent.click(screen.getByRole("button", { name: "Switch" }));
  await waitFor(() =>
    expect(screen.getByTestId("path")).toHaveTextContent("/billing/two"),
  );
  expect(screen.getByTestId("active")).toHaveTextContent("two");
});
