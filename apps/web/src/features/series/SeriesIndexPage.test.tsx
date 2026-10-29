import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SeriesIndexPage } from "./SeriesIndexPage";
const mocks = vi.hoisted(() => ({ create: vi.fn(), archive: vi.fn() }));
vi.mock("@dirrio/backend", () => ({
  api: {
    series: { list: "series", create: "create", setArchived: "archive" },
    projects: { listMine: "projects" },
  },
}));
vi.mock("@/lib/api/hooks", () => ({
  useQuery: (ref: string) =>
    ref === "projects"
      ? []
      : [
          {
            _id: "active",
            title: "First Series",
            description: "A shared story",
            aspectRatio: "16:9",
            fps: 24,
            updatedAt: 2,
          },
          {
            _id: "archived",
            title: "Old Series",
            description: "",
            aspectRatio: "16:9",
            fps: 24,
            updatedAt: 1,
            archivedAt: 1,
          },
        ],
  useMutation: (ref: string) =>
    ref === "create" ? mocks.create : mocks.archive,
}));
function setup(entry = "/series") {
  render(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route path="series" element={<SeriesIndexPage />} />
        <Route path="series/:id" element={<h1>Series detail</h1>} />
      </Routes>
    </MemoryRouter>,
  );
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.create.mockResolvedValue("new-series");
  mocks.archive.mockResolvedValue(null);
});
describe("Series library", () => {
  it("filters archived series, changes view, and opens real cards", async () => {
    setup();
    expect(screen.getAllByRole("article")).toHaveLength(2);
    await userEvent.click(screen.getByRole("button", { name: "Archived" }));
    expect(screen.getAllByRole("article")).toHaveLength(1);
    expect(
      screen.queryByRole("heading", { name: "First Series" }),
    ).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "List view" }));
    expect(screen.getByRole("button", { name: "List view" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });
  it("searches by the header query", () => {
    setup("/series?q=first");
    expect(screen.getAllByRole("article")).toHaveLength(1);
    expect(
      screen.getByRole("heading", { name: "First Series" }),
    ).toBeInTheDocument();
  });
  it("creates a named series from the dialog", async () => {
    setup();
    await userEvent.click(screen.getByRole("button", { name: "New series" }));
    expect(
      screen.getByRole("button", { name: "Create series" }),
    ).toBeDisabled();
    await userEvent.type(
      screen.getByRole("textbox", { name: "Series name" }),
      "New story",
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Create series" }),
    );
    expect(mocks.create).toHaveBeenCalledWith({ title: "New story" });
    expect(
      await screen.findByRole("heading", { name: "Series detail" }),
    ).toBeInTheDocument();
  });
  it("restores archived series through the action menu", async () => {
    setup();
    await userEvent.click(
      screen.getByRole("button", { name: "Actions for Old Series" }),
    );
    await userEvent.click(
      screen.getByRole("menuitem", { name: "Restore series" }),
    );
    expect(mocks.archive).toHaveBeenCalledWith({
      seriesId: "archived",
      archived: false,
    });
  });
});
