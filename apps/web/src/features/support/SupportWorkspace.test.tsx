import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { getFunctionName } from "convex/server";
import { SupportWidget, SupportWorkspace } from "@dirrio/ui/support";
const state = vi.hoisted(() => ({
  mutation: vi.fn(),
  client: { queries: new Map(), load: vi.fn() },
}));
vi.mock("@dirrio/api-client/context", () => ({
  useClient: () => state.client,
}));
vi.mock("@dirrio/api-client", () => ({
  useMutation: () => state.mutation,
  useAction: () => state.mutation,
  useQueryStatus: () => ({ isReconnecting: false }),
  useQuery: (ref: Parameters<typeof getFunctionName>[0], args: unknown) => {
    if (args === "skip") return undefined;
    const name = getFunctionName(ref);
    if (name === "users:viewer") return { _id: "staff-1", isStaff: true };
    if (name === "support:article")
      return {
        _id: "article-1",
        title: "Export guide",
        category: "Studio",
        body: "Open Studio and review your export settings.",
        language: "en",
        published: true,
      };
    if (name === "support:articles")
      return {
        page: [
          {
            _id: "article-1",
            title: "Export guide",
            category: "Studio",
            body: "Open Studio and review your export settings.",
            language: "en",
            published: true,
          },
        ],
        isDone: true,
      };
    if (name === "support:detail")
      return {
        conversation: {
          _id: "conversation-1",
          userId: "customer-1",
          subject: "Export question",
          status: "staff",
          mode: "human",
          revision: 0,
          sequence: 0,
          publicSequence: 0,
          staffRead: 0,
          customerRead: 0,
        },
        page: [
          {
            _id: "message-1",
            role: "assistant",
            language: "en",
            text: "Read the export guide.",
            createdAt: 0,
            attachments: [],
            sources: [{ id: "article-1", title: "Export guide" }],
          },
        ],
        isDone: true,
      };
    return {
      page: [
        {
          _id: "conversation-1",
          subject: "Export question",
          customer: "creator@example.com",
          status: "staff",
          mode: "queued",
          updatedAt: 0,
          sequence: 0,
          customerRead: 0,
          staffRead: 0,
        },
      ],
      isDone: true,
    };
  },
}));
afterEach(() => {
  cleanup();
  state.mutation.mockClear();
});
it("keeps help articles inside the customer dialog rather than nesting another modal", () => {
  render(<SupportWidget />);
  fireEvent.click(screen.getByRole("button", { name: "Help and support" }));
  fireEvent.click(screen.getByRole("button", { name: "Help articles" }));
  fireEvent.click(screen.getByRole("button", { name: "Export guide" }));
  expect(screen.getAllByRole("dialog")).toHaveLength(1);
  expect(
    screen.getByRole("heading", { name: "Export guide" }),
  ).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Contact support" }));
  expect(
    screen.getByRole("button", { name: "New conversation" }),
  ).toBeInTheDocument();
  expect(state.mutation).not.toHaveBeenCalled();
});
it("separates staff notes and groups management actions without sending messages", () => {
  render(<SupportWorkspace staff view="chats" />);
  fireEvent.click(screen.getByRole("button", { name: /Export question/ }));
  expect(
    screen.getByText("Conversation actions").closest("details"),
  ).not.toHaveAttribute("open");
  fireEvent.click(screen.getByText("Conversation actions"));
  expect(
    screen.getByRole("button", { name: "Create support case" }),
  ).toBeEnabled();
  fireEvent.click(screen.getByRole("checkbox", { name: "Internal note" }));
  expect(
    screen.getByRole("button", { name: "Add internal note" }),
  ).toBeDisabled();
  fireEvent.change(screen.getByLabelText("Your message"), {
    target: { value: "Draft internal note" },
  });
  expect(
    screen.getByRole("button", { name: "Add internal note" }),
  ).toBeEnabled();
  expect(state.mutation).not.toHaveBeenCalled();
});

it("preserves an unsent reply when opening a cited help article", () => {
  render(<SupportWidget />);
  fireEvent.click(screen.getByRole("button", { name: "Help and support" }));
  fireEvent.click(screen.getByRole("button", { name: /Export question/ }));
  fireEvent.change(screen.getByLabelText("Your message"), {
    target: { value: "Unsent follow-up question" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Export guide" }));
  expect(
    screen.getByRole("heading", { name: "Export guide" }),
  ).toBeInTheDocument();
  fireEvent.click(screen.getAllByRole("button", { name: "Back" })[0]!);
  expect(screen.getByLabelText("Your message")).toHaveValue(
    "Unsent follow-up question",
  );
  expect(state.mutation).not.toHaveBeenCalled();
});
