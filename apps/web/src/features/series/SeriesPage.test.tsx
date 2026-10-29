import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SeriesPage } from "./SeriesPage";
const m = vi.hoisted(() => ({ mutate: vi.fn() }));
vi.mock("@dirrio/backend", () => ({
  api: {
    series: {
      get: "get",
      createEpisode: "create",
      setMembership: "membership",
      setArchived: "archive",
      reorderEpisodes: "reorder",
      update: "update",
    },
    projects: {
      listMine: "projects",
      archive: "archiveEpisode",
      unarchive: "restoreEpisode",
    },
  },
}));
vi.mock("./ResourceLibrary", () => ({
  ResourceLibrary: () => <h2>Shared resources</h2>,
}));
vi.mock("@/lib/api/hooks", () => ({
  useMutation: (ref: string) => (args: unknown) => m.mutate(ref, args),
  useQuery: (ref: string) =>
    ref === "get"
      ? {
          series: {
            _id: "series",
            workspaceId: "workspace",
            title: "Test Series",
            description: "A story",
            aspectRatio: "16:9",
            fps: 24,
            rules: [],
            styleNotes: "",
            settingsVersion: 1,
          },
          episodes: [
            { _id: "one", title: "Arrival", episodeNumber: 1 },
            { _id: "two", title: "Signal", episodeNumber: 2 },
          ],
        }
      : [
          {
            project: { _id: "standalone", title: "Standalone" },
            thumbnailUrl: null,
          },
        ],
}));
function setup() {
  render(
    <MemoryRouter initialEntries={["/series/series"]}>
      <Routes>
        <Route path="series/:seriesId" element={<SeriesPage />} />
      </Routes>
    </MemoryRouter>,
  );
}
beforeEach(() => {
  vi.clearAllMocks();
  HTMLElement.prototype.scrollIntoView = vi.fn();
  HTMLElement.prototype.hasPointerCapture = vi.fn(() => false);
  HTMLElement.prototype.setPointerCapture = vi.fn();
  HTMLElement.prototype.releasePointerCapture = vi.fn();
  m.mutate.mockResolvedValue(undefined);
});
describe("Series detail", () => {
  it("renders episode rows, custom project selection and tabs", async () => {
    setup();
    expect(
      screen.getByRole("heading", { name: "Arrival" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("combobox", { name: "Standalone project" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Attach project" }),
    ).toBeDisabled();
    await userEvent.click(
      screen.getByRole("button", { name: "Shared library" }),
    );
    expect(
      screen.getByRole("heading", { name: "Shared resources" }),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Settings" }));
    expect(
      screen.getByRole("combobox", { name: "Aspect ratio" }),
    ).toBeInTheDocument();
  });
  it("attaches the selected standalone project", async () => {
    setup();
    await userEvent.click(
      screen.getByRole("combobox", { name: "Standalone project" }),
    );
    await userEvent.click(screen.getByRole("option", { name: "Standalone" }));
    await userEvent.click(
      screen.getByRole("button", { name: "Attach project" }),
    );
    expect(m.mutate).toHaveBeenCalledWith("membership", {
      projectId: "standalone",
      seriesId: "series",
    });
  });
  it("reorders episodes through the action menu", async () => {
    setup();
    await userEvent.click(
      screen.getByRole("button", { name: "Actions for Signal" }),
    );
    await userEvent.click(screen.getByRole("menuitem", { name: "Move up" }));
    expect(m.mutate).toHaveBeenCalledWith("reorder", {
      seriesId: "series",
      projectIds: ["two", "one"],
    });
  });
  it("saves series defaults with normalized production rules", async () => {
    setup();
    await userEvent.click(screen.getByRole("button", { name: "Settings" }));
    await userEvent.type(
      screen.getByRole("textbox", { name: "Description" }),
      "Shared world",
    );
    await userEvent.type(
      screen.getByRole("textbox", { name: "Style notes" }),
      "Warm light",
    );
    await userEvent.type(
      screen.getByRole("textbox", { name: "Production rules" }),
      " Keep characters consistent.\n\n Use natural light. ",
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Save defaults" }),
    );
    expect(m.mutate).toHaveBeenCalledWith(
      "update",
      expect.objectContaining({
        seriesId: "series",
        title: "Test Series",
        description: "A storyShared world",
        styleNotes: "Warm light",
        rules: ["Keep characters consistent.", "Use natural light."],
        aspectRatio: "16:9",
        fps: 24,
      }),
    );
    expect(await screen.findByRole("status")).toHaveTextContent(
      "Defaults saved.",
    );
  });
});
