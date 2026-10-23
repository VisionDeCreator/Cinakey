import { render, screen } from "@testing-library/react";
import { ConvexProvider, ConvexReactClient } from "convex/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { ProjectsPage } from "@/features/projects/ProjectsPage";

vi.mock("@/lib/api/hooks", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api/hooks")>(
    "@/lib/api/hooks",
  );
  return {
    ...actual,
    useQuery: () => [],
    useMutation: () => vi.fn(),
    useAction: () => vi.fn(),
  };
});

describe("ProjectsPage", () => {
  it("renders empty state when there are no projects", () => {
    const client = new ConvexReactClient("https://example.convex.cloud");
    render(
      <ConvexProvider client={client}>
        <MemoryRouter>
          <ProjectsPage />
        </MemoryRouter>
      </ConvexProvider>,
    );
    expect(screen.getByText("No projects yet.")).toBeInTheDocument();
    expect(
      screen.getAllByRole("button", { name: /Trailer template/i }).length,
    ).toBeGreaterThanOrEqual(1);
    expect(
      screen.getAllByRole("button", { name: /New project/i }).length,
    ).toBeGreaterThanOrEqual(1);
  });
});
