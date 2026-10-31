import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { getFunctionName } from "convex/server";
import type { Id } from "@dirrio/backend";
import { SeriesIndexPage } from "./SeriesIndexPage";
import { ResourceLibrary } from "./ResourceLibrary";
const state = vi.hoisted(() => ({ query: vi.fn(), write: vi.fn() }));
vi.mock("@/lib/api/hooks", () => ({
  useQuery: (ref: Parameters<typeof getFunctionName>[0], args: unknown) =>
    state.query(getFunctionName(ref), args),
  useMutation:
    (ref: Parameters<typeof getFunctionName>[0]) => (args: unknown) =>
      state.write(getFunctionName(ref), args),
}));
afterEach(cleanup);
beforeEach(() => {
  state.query.mockReset();
  state.write.mockReset();
});
it("creates a Series without a provider call and opens its workspace", async () => {
  state.query.mockReturnValue([]);
  state.write.mockResolvedValue("series-one");
  render(
    <MemoryRouter initialEntries={["/series"]}>
      <Routes>
        <Route path="/series" element={<SeriesIndexPage />} />
        <Route path="/series/:id" element={<p>Series opened</p>} />
      </Routes>
    </MemoryRouter>,
  );
  fireEvent.click(screen.getByRole("button", { name: "New series" }));
  fireEvent.change(screen.getByLabelText("Series name"), {
    target: { value: "Harbour" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Create series" }));
  await screen.findByText("Series opened");
  expect(state.write).toHaveBeenCalledWith("series:create", {
    title: "Harbour",
  });
  expect(fetch).not.toHaveBeenCalled();
});
it("adopts an explicit resource version into an episode without generating media", async () => {
  state.query.mockImplementation((name: string) =>
    name === "resources:list"
      ? {
          items: [
            {
              resource: {
                _id: "resource",
                kind: "media",
                currentVersionId: "version",
              },
              version: {
                _id: "version",
                name: "Intro",
                version: 2,
                description: "Series opening",
                assetIds: ["asset"],
              },
            },
          ],
          cursor: "",
          isDone: true,
        }
      : name === "resources:listForProject"
        ? []
        : undefined,
  );
  state.write.mockResolvedValue("binding");
  render(
    <ResourceLibrary
      seriesId={"series" as Id<"series">}
      projectId={"episode" as Id<"projects">}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Use current version" }));
  await waitFor(() =>
    expect(state.write).toHaveBeenCalledWith("resources:useInProject", {
      projectId: "episode",
      versionId: "version",
    }),
  );
  expect(state.write).toHaveBeenCalledTimes(1);
  expect(fetch).not.toHaveBeenCalled();
});
it("disables re-import of a version already pinned to the episode", () => {
  state.query.mockImplementation((name: string) =>
    name === "resources:list"
      ? {
          items: [
            {
              resource: { _id: "resource", kind: "media" },
              version: {
                _id: "version",
                name: "Intro",
                version: 1,
                assetIds: [],
              },
            },
          ],
          cursor: "",
          isDone: true,
        }
      : name === "resources:listForProject"
        ? [
            {
              binding: { _id: "binding", versionId: "version" },
              version: { name: "Intro", version: 1 },
              resource: { currentVersionId: "version" },
            },
          ]
        : undefined,
  );
  render(
    <ResourceLibrary
      seriesId={"series" as Id<"series">}
      projectId={"episode" as Id<"projects">}
    />,
  );
  expect(
    screen.getByRole("button", { name: "Current version added" }),
  ).toBeDisabled();
});
