import userEvent from "@testing-library/user-event";
import { ConfirmContext } from "@/components/use-confirm";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { getFunctionName } from "convex/server";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { TeamSettings } from "./TeamSettings";

const state = vi.hoisted(() => ({
  role: "owner",
  hasInvitation: false,
  invite: vi.fn(),
  accept: vi.fn(),
  assign: vi.fn(),
  transfer: vi.fn(),
}));
vi.mock("@/lib/api/hooks", () => ({
  useQuery: (ref: Parameters<typeof getFunctionName>[0]) => {
    switch (getFunctionName(ref)) {
      case "teams:list":
        return [
          { workspace: { _id: "workspace", name: "Studio" }, role: state.role },
        ];
      case "teams:members":
        return [
          { userId: "owner", email: "owner@test.com", role: "owner" },
          { userId: "creator", email: "creator@test.com", role: "creator" },
        ];
      case "teams:productions":
        return {
          projects: [{ _id: "project", title: "Client film" }],
          series: [{ _id: "series", title: "Campaign" }],
        };
      case "teams:invitations":
        return state.hasInvitation
          ? [{ _id: "invite", workspaceName: "Client studio", role: "creator" }]
          : [];
      default:
        return [];
    }
  },
  useMutation: (ref: Parameters<typeof getFunctionName>[0]) => {
    switch (getFunctionName(ref)) {
      case "teams:invite":
        return state.invite;
      case "teams:accept":
        return state.accept;
      case "teams:assign":
        return state.assign;
      case "teams:transferOwnership":
        return state.transfer;
      default:
        return vi.fn();
    }
  },
}));
beforeEach(() => {
  HTMLElement.prototype.scrollIntoView = vi.fn();
  HTMLElement.prototype.hasPointerCapture = vi.fn(() => false);
  HTMLElement.prototype.setPointerCapture = vi.fn();
  HTMLElement.prototype.releasePointerCapture = vi.fn();
  state.role = "owner";
  state.hasInvitation = false;
  state.invite.mockReset().mockResolvedValue("invite");
  state.accept.mockReset().mockResolvedValue("workspace");
  state.assign.mockReset().mockResolvedValue(null);
  state.transfer.mockReset().mockResolvedValue(null);
});
afterEach(cleanup);

it("creates an invitation and explains where the recipient can accept it", async () => {
  render(<TeamSettings />);
  fireEvent.change(screen.getByLabelText("Invite by email"), {
    target: { value: "person@test.com" },
  });
  fireEvent.click(screen.getByRole("button", { name: /^Invite$/ }));
  await waitFor(() =>
    expect(state.invite).toHaveBeenCalledWith({
      workspaceId: "workspace",
      email: "person@test.com",
      role: "creator",
    }),
  );
  expect(await screen.findByRole("status")).toHaveTextContent(
    "queued for email delivery",
  );
});
it("accepts incoming invitations without granting administration controls to creators", async () => {
  state.role = "creator";
  state.hasInvitation = true;
  render(<TeamSettings />);
  expect(screen.queryByLabelText("Invite by email")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Accept invitation" }));
  await waitFor(() =>
    expect(state.accept).toHaveBeenCalledWith({ invitationId: "invite" }),
  );
});
it("assigns projects and whole series explicitly", async () => {
  render(<TeamSettings />);
  fireEvent.click(screen.getByLabelText("Client film"));
  await waitFor(() =>
    expect(state.assign).toHaveBeenCalledWith({
      workspaceId: "workspace",
      userId: "creator",
      projectId: "project",
      enabled: true,
    }),
  );
  fireEvent.click(screen.getByLabelText("Series: Campaign (all episodes)"));
  await waitFor(() =>
    expect(state.assign).toHaveBeenCalledWith({
      workspaceId: "workspace",
      userId: "creator",
      seriesId: "series",
      enabled: true,
    }),
  );
});
it("retains the invitation draft and exposes server errors", async () => {
  state.invite.mockRejectedValue(new Error("Workspace access denied"));
  render(<TeamSettings />);
  fireEvent.change(screen.getByLabelText("Invite by email"), {
    target: { value: "person@test.com" },
  });
  fireEvent.click(screen.getByRole("button", { name: /^Invite$/ }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Workspace access denied",
  );
  expect(screen.getByLabelText("Invite by email")).toHaveValue(
    "person@test.com",
  );
});

it("requires explicit confirmation before transferring workspace ownership", async () => {
  const confirm = vi.fn().mockResolvedValue(true);
  render(
    <ConfirmContext.Provider value={confirm}>
      <TeamSettings />
    </ConfirmContext.Provider>,
  );
  await userEvent.click(
    screen.getByRole("combobox", { name: "Transfer ownership" }),
  );
  await userEvent.click(
    screen.getByRole("option", { name: "creator@test.com" }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Transfer ownership" }));
  await waitFor(() =>
    expect(state.transfer).toHaveBeenCalledWith({
      workspaceId: "workspace",
      newOwnerId: "creator",
    }),
  );
  expect(confirm).toHaveBeenCalledWith(
    expect.objectContaining({ title: "Transfer workspace ownership?" }),
  );
});
it("does not transfer ownership if the confirmation is canceled", async () => {
  const confirm = vi.fn().mockResolvedValue(false);
  render(
    <ConfirmContext.Provider value={confirm}>
      <TeamSettings />
    </ConfirmContext.Provider>,
  );
  await userEvent.click(
    screen.getByRole("combobox", { name: "Transfer ownership" }),
  );
  await userEvent.click(
    screen.getByRole("option", { name: "creator@test.com" }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Transfer ownership" }));
  await waitFor(() => expect(confirm).toHaveBeenCalled());
  expect(state.transfer).not.toHaveBeenCalled();
});

it("switches to the accepted workspace only after provider membership refreshes", async () => {
  state.hasInvitation = true;
  const switchWorkspace = vi.fn().mockResolvedValue(undefined);
  const { WorkspaceContext } =
    await import("@/features/workspaces/workspace-context");
  const personal = {
    workspace: { _id: "personal" as never, name: "Personal" },
    role: "owner" as const,
  };
  const value = {
    workspaceId: "personal" as never,
    canCreate: true,
    canManage: true,
    workspaces: [personal],
    switchWorkspace,
  };
  const view = render(
    <WorkspaceContext.Provider value={value}>
      <TeamSettings />
    </WorkspaceContext.Provider>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Accept invitation" }));
  await waitFor(() => expect(state.accept).toHaveBeenCalled());
  expect(switchWorkspace).not.toHaveBeenCalled();
  view.rerender(
    <WorkspaceContext.Provider
      value={{
        ...value,
        workspaces: [
          personal,
          {
            workspace: { _id: "workspace" as never, name: "Studio" },
            role: "creator",
          },
        ],
      }}
    >
      <TeamSettings />
    </WorkspaceContext.Provider>,
  );
  await waitFor(() =>
    expect(switchWorkspace).toHaveBeenCalledWith("workspace"),
  );
});
