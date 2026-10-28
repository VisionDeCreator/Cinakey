import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ConvexProvider, ConvexReactClient } from "convex/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ProjectsPage } from "@/features/projects/ProjectsPage";
import { WorkspaceContext } from "@/features/workspaces/workspace-context";

const data = vi.hoisted(() => ({
  rows: [] as Array<{
    project: {
      _id: string;
      title: string;
      updatedAt: number;
      seriesId?: string;
    };
    thumbnailUrl: null;
    progress: {
      assets: "empty";
      script: "empty";
      blockout: "empty";
      video: "empty";
      edit: "empty";
    };
  }>,
}));
vi.mock("@/lib/api/hooks", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/api/hooks")>("@/lib/api/hooks");
  return { ...actual, useQuery: () => data.rows, useMutation: () => vi.fn() };
});
function setup(canCreate = true, entry = "/projects") {
  const client = new ConvexReactClient("https://example.convex.cloud");
  return render(
    <ConvexProvider client={client}>
      <MemoryRouter initialEntries={[entry]}>
        <WorkspaceContext.Provider
          value={{
            canCreate,
            canManage: canCreate,
            workspaces: [],
            switchWorkspace: async () => {},
          }}
        >
          <ProjectsPage />
        </WorkspaceContext.Provider>
      </MemoryRouter>
    </ConvexProvider>,
  );
}
const progress = {
  assets: "empty",
  script: "empty",
  blockout: "empty",
  video: "empty",
  edit: "empty",
} as const;
beforeEach(() => {
  data.rows = [];
});

describe("ProjectsPage", () => {
  it("offers blank project creation without the retired template", async () => {
    setup();
    expect(screen.getByText("No projects yet.")).toBeInTheDocument();
    expect(screen.queryByText(/Trailer template/i)).not.toBeInTheDocument();
    await userEvent.click(
      screen.getAllByRole("button", { name: /^New project$/i })[0]!,
    );
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
  it("filters by title and category, sorts projects and switches views", async () => {
    data.rows = [
      {
        project: { _id: "alpha", title: "Alpha", updatedAt: 1 },
        thumbnailUrl: null,
        progress,
      },
      {
        project: { _id: "zebra", title: "Zebra", updatedAt: 2 },
        thumbnailUrl: null,
        progress,
      },
      {
        project: {
          _id: "episode",
          title: "Episode One",
          updatedAt: 3,
          seriesId: "series",
        },
        thumbnailUrl: null,
        progress,
      },
    ];
    setup();
    expect(
      screen
        .getAllByRole("article")
        .map((card) => within(card).getByRole("heading").textContent),
    ).toEqual(["Zebra", "Alpha"]);
    await userEvent.selectOptions(
      screen.getByRole("combobox", { name: "Sort projects" }),
      "title",
    );
    expect(
      within(screen.getAllByRole("article")[0]!).getByRole("heading"),
    ).toHaveTextContent("Alpha");
    await userEvent.click(screen.getByRole("button", { name: "Episodes" }));
    expect(screen.getAllByRole("article")).toHaveLength(1);
    expect(
      screen.getByRole("heading", { name: "Episode One" }),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "List view" }));
    expect(screen.getByRole("button", { name: "List view" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });
  it("filters projects using the header search query", () => {
    data.rows = [
      {
        project: { _id: "alpha", title: "Alpha", updatedAt: 1 },
        thumbnailUrl: null,
        progress,
      },
      {
        project: { _id: "zebra", title: "Zebra", updatedAt: 2 },
        thumbnailUrl: null,
        progress,
      },
    ];
    setup(true, "/projects?q=zeb");
    expect(screen.getAllByRole("article")).toHaveLength(1);
    expect(screen.getByRole("heading", { name: "Zebra" })).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "Alpha" }),
    ).not.toBeInTheDocument();
  });
  it("disables creation for members without creation permissions", () => {
    setup(false);
    for (const button of screen.getAllByRole("button", {
      name: /New project/i,
    }))
      expect(button).toBeDisabled();
    expect(
      screen.queryByRole("link", { name: /New series/ }),
    ).not.toBeInTheDocument();
  });
});
