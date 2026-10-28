import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Id } from "@cinakey/backend";
import { ResourceLibrary } from "./ResourceLibrary";
const m = vi.hoisted(() => ({ mutate: vi.fn() }));
vi.mock("@cinakey/backend", () => ({
  api: {
    resources: {
      list: "list",
      listForProject: "bindings",
      publish: "publish",
      useInProject: "adopt",
      setArchived: "archive",
      createUploadUrl: "upload",
      completeUpload: "complete",
      versions: "versions",
      assetUrls: "urls",
    },
    projects: { listMine: "projects" },
    assets: { list: "assets" },
    entities: { listForProject: "entities" },
  },
}));
vi.mock("@/lib/api/hooks", () => ({
  useMutation: (ref: string) => (args: unknown) => m.mutate(ref, args),
  useQuery: (ref: string, args: unknown) => {
    if (args === "skip") return undefined;
    if (ref === "list")
      return {
        items: [
          {
            resource: { _id: "maya", kind: "character" },
            version: {
              _id: "v1",
              version: 1,
              name: "Maya",
              description: "Desert explorer",
              assetIds: [],
            },
          },
          {
            resource: { _id: "radio", kind: "prop" },
            version: {
              _id: "v2",
              version: 2,
              name: "Radio",
              description: "Field communicator",
              assetIds: [],
            },
          },
        ],
        isDone: true,
        cursor: "",
      };
    return [];
  },
}));
function setup() {
  render(<ResourceLibrary seriesId={"series" as Id<"series">} />);
}
beforeEach(() => {
  vi.clearAllMocks();
  m.mutate.mockResolvedValue(undefined);
  HTMLElement.prototype.scrollIntoView = vi.fn();
  HTMLElement.prototype.hasPointerCapture = vi.fn(() => false);
  HTMLElement.prototype.setPointerCapture = vi.fn();
  HTMLElement.prototype.releasePointerCapture = vi.fn();
});
describe("Shared library", () => {
  it("filters resource cards by kind and search", async () => {
    setup();
    expect(screen.getAllByRole("article")).toHaveLength(2);
    await userEvent.click(screen.getByRole("button", { name: "Characters" }));
    expect(screen.getAllByRole("article")).toHaveLength(1);
    expect(screen.getByRole("heading", { name: "Maya" })).toBeInTheDocument();
    await userEvent.type(
      screen.getByRole("textbox", { name: "Search resources" }),
      "missing",
    );
    expect(
      screen.getByText("No matching resources on this page."),
    ).toBeInTheDocument();
  });
  it("opens the upload dialog and retains likeness consent gating", async () => {
    setup();
    await userEvent.click(screen.getByRole("button", { name: "Upload media" }));
    const input = screen.getByLabelText("Upload shared media", {
      selector: "input",
    });
    expect(input).toBeEnabled();
    await userEvent.click(
      screen.getByRole("checkbox", { name: "These files depict real people" }),
    );
    expect(input).toBeDisabled();
    await userEvent.click(
      screen.getByRole("checkbox", {
        name: "I have consent to use their likenesses",
      }),
    );
    expect(input).toBeEnabled();
  });
  it("publishes a named resource from the dialog", async () => {
    setup();
    await userEvent.click(
      screen.getByRole("button", { name: "Create resource" }),
    );
    expect(
      screen.getByRole("button", { name: "Create resource" }),
    ).toBeDisabled();
    await userEvent.type(
      screen.getByRole("textbox", { name: "Resource name" }),
      "New resource",
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Create resource" }),
    );
    expect(m.mutate).toHaveBeenCalledWith(
      "publish",
      expect.objectContaining({
        seriesId: "series",
        name: "New resource",
        kind: "media",
      }),
    );
  });
  it("keeps revision and archive actions in each card menu", async () => {
    setup();
    await userEvent.click(
      screen.getByRole("button", { name: "Actions for Maya" }),
    );
    await userEvent.click(screen.getByRole("menuitem", { name: "Edit" }));
    expect(screen.getByRole("textbox", { name: "Resource name" })).toHaveValue(
      "Maya",
    );
    expect(
      screen.getByRole("combobox", { name: "Resource kind" }),
    ).toBeDisabled();
  });
  it("opens a resource drawer with details and versions", async () => {
    setup();
    await userEvent.click(screen.getByRole("button", { name: "Preview Maya" }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(
      screen.getByText(
        /Episodes keep their adopted versions\. Editing creates a new version/,
      ),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Versions" }));
    expect(screen.getByRole("button", { name: "Edit" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Edit" }));
    expect(screen.getByRole("textbox", { name: "Resource name" })).toHaveValue(
      "Maya",
    );
  });
});

it("offers recoverable deletion and an archived-resource filter", async () => {
  setup();
  await userEvent.click(
    screen.getByRole("button", { name: "Actions for Maya" }),
  );
  await userEvent.click(screen.getByRole("menuitem", { name: "Delete" }));
  expect(m.mutate).toHaveBeenCalledWith("archive", {
    resourceId: "maya",
    archived: true,
  });
  expect(
    screen.getByRole("checkbox", { name: "Show archived resources" }),
  ).toBeInTheDocument();
});
