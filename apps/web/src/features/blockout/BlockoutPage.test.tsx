import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { getFunctionName } from "convex/server";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { BlockoutPage } from "./BlockoutPage";
const m = vi.hoisted(() => ({
  ready: true,
  ensure: vi.fn().mockResolvedValue(undefined),
  load: vi.fn().mockResolvedValue({ document: { frames: 240, fps: 24 } }),
  generate: vi.fn(),
  confirm: vi.fn().mockResolvedValue(false),
}));
vi.mock("@/components/use-confirm", () => ({ useConfirm: () => m.confirm }));
vi.mock("./export/ExportDialog", () => ({ ExportDialog: () => null }));
vi.mock("@/lib/api/hooks", () => ({
  useQuery: (ref: Parameters<typeof getFunctionName>[0], args: unknown) => {
    if (args === "skip") return undefined;
    const name = getFunctionName(ref);
    if (name === "workspace:list")
      return {
        migrated: true,
        staging: [
          {
            _id: "s1",
            name: "Desert crossing",
            contentFileId: "f1",
            previzAssetId: m.ready ? "preview" : undefined,
          },
          { _id: "s2", name: "Outpost arrival", contentFileId: "f2" },
        ],
      };
    if (name === "workspace:estimateStaging") return { usdMicros: 40000 };
    if (name === "storage:getAssetUrl")
      return "https://fixture.test/preview.mp4";
    return undefined;
  },
  useAction: (ref: Parameters<typeof getFunctionName>[0]) =>
    getFunctionName(ref) === "workspace:ensure"
      ? m.ensure
      : getFunctionName(ref) === "workspace:loadStaging"
        ? m.load
        : m.generate,
  useMutation: () => m.generate,
}));
function Location() {
  return <span data-testid="location">{useLocation().search}</span>;
}
function mount(useReference = vi.fn()) {
  render(
    <MemoryRouter initialEntries={["/projects/p/studio?staging=s1&keep=yes"]}>
      <Routes>
        <Route
          path="/projects/:projectId/studio"
          element={
            <>
              <BlockoutPage onUseForGeneration={useReference} />
              <Location />
            </>
          }
        />
      </Routes>
    </MemoryRouter>,
  );
  return useReference;
}
beforeEach(() => {
  vi.clearAllMocks();
  m.ready = true;
  HTMLElement.prototype.scrollIntoView = vi.fn();
  HTMLElement.prototype.hasPointerCapture = vi.fn(() => false);
  HTMLElement.prototype.setPointerCapture = vi.fn();
  HTMLElement.prototype.releasePointerCapture = vi.fn();
});
afterEach(cleanup);
it("uses a rendered staging reference and exposes a keyboard-adjustable duration", async () => {
  const reference = mount();
  await act(async () => {});
  expect(screen.getByRole("slider", { name: "Staging duration" })).toHaveValue(
    "10",
  );
  fireEvent.change(screen.getByRole("slider", { name: "Staging duration" }), {
    target: { value: "30" },
  });
  expect(screen.getByText("30 seconds")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Use for generation" }));
  expect(reference).toHaveBeenCalledWith("s1");
});
it("keeps other workspace parameters when switching documents", async () => {
  mount();
  await act(async () => {});
  const user = userEvent.setup();
  await user.click(screen.getByRole("combobox", { name: "Staging document" }));
  await user.click(screen.getByRole("option", { name: "Outpost arrival" }));
  expect(screen.getByTestId("location")).toHaveTextContent(
    "staging=s2&keep=yes",
  );
  expect(
    screen.getByRole("button", { name: "Use for generation" }),
  ).toBeDisabled();
});
it("does not enable an unrendered reference or generate without cost confirmation", async () => {
  m.ready = false;
  mount();
  await act(async () => {});
  expect(
    screen.getByRole("button", { name: "Use for generation" }),
  ).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: /Generate staging/ }));
  await act(async () => {});
  expect(m.confirm).toHaveBeenCalled();
  expect(m.generate).not.toHaveBeenCalled();
});
