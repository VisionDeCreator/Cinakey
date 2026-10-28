import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import { getFunctionName } from "convex/server";
import { GenjutsuPage } from "./GenjutsuPage";
const mocks = vi.hoisted(() => ({
  sessions: [] as { _id: string; title: string; updatedAt: number }[],
  create: vi.fn(),
  remove: vi.fn(),
  upload: vi.fn(),
  assets: [] as { _id: string; name: string; type: string }[],
  urls: [] as { assetId: string; url: string }[],
  session: null as null | Record<string, unknown>,
}));
vi.mock("@/lib/api/hooks", () => ({
  useQuery: (ref: Parameters<typeof getFunctionName>[0]) => {
    const name = getFunctionName(ref);
    if (name === "assets:list") return mocks.assets;
    if (name === "storage:listProjectAssetUrls") return mocks.urls;
    if (name === "genjutsu:list") return mocks.sessions;
    if (name === "genjutsu:get") return mocks.session;
    if (name === "workspace:videos") return { videos: [], jobs: [] };
    if (name === "generation:estimateCost") return { usdMicros: 10 };
    return [];
  },
  useMutation: (ref: Parameters<typeof getFunctionName>[0]) =>
    getFunctionName(ref) === "genjutsu:removeInput"
      ? mocks.remove
      : mocks.create,
  useAction: () => vi.fn(),
}));
vi.mock("@/features/assets/useAssetUpload", () => ({
  useAssetUpload: () => ({ uploads: [], uploadFiles: mocks.upload }),
}));
afterEach(() => {
  cleanup();
  localStorage.clear?.();
  mocks.session = null;
  mocks.sessions = [];
  mocks.assets = [];
  mocks.urls = [];
  vi.clearAllMocks();
});
function show(path: string) {
  const tree = () => (
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/remix" element={<GenjutsuPage />} />
        <Route path="/remix/:sessionId" element={<GenjutsuPage />} />
      </Routes>
    </MemoryRouter>
  );
  const view = render(tree());
  return { ...view, refresh: () => view.rerender(tree()) };
}
it("offers an independent Genjutsu section without a project selector", () => {
  show("/remix");
  expect(screen.getByRole("heading", { name: "Remix" })).toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: "New transformation" }),
  ).toBeInTheDocument();
  expect(
    screen.getByText(/Your saved transformations will appear here/),
  ).toBeInTheDocument();
  expect(screen.queryByText("Select a project")).not.toBeInTheDocument();
});
it("gives sessions their own uploads, preview, versions, and transformation controls", () => {
  mocks.session = {
    _id: "session",
    storageScopeId: "scope",
    title: "Test transformation",
  };
  show("/remix/session");
  expect(screen.getByLabelText("Upload source video")).toBeInTheDocument();
  expect(screen.getByLabelText("Upload reference images")).toBeInTheDocument();
  expect(
    screen.getByRole("region", { name: "Transformation preview" }),
  ).toBeInTheDocument();
  expect(
    screen.getByRole("complementary", { name: "Transformation controls" }),
  ).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Result" }));
  expect(screen.queryByText("Your source goes here")).not.toBeInTheDocument();
  expect(screen.getByText("A new version awaits")).toBeInTheDocument();
});

it("routes dropped source and reference files to their matching uploads and selects the uploaded source", async () => {
  mocks.session = {
    _id: "session",
    storageScopeId: "scope",
    title: "Drop test",
  };
  mocks.upload.mockResolvedValue(["uploaded-source"]);
  show("/remix/session");
  const video = new File(["clip"], "source.mp4", { type: "video/mp4" });
  const images = [
    new File(["a"], "a.png", { type: "image/png" }),
    new File(["b"], "b.png", { type: "image/png" }),
  ];
  await act(async () => {
    fireEvent.drop(
      screen.getByLabelText("Upload source video").closest("label")!,
      { dataTransfer: { files: [video], types: ["Files"] } },
    );
  });
  expect(mocks.upload).toHaveBeenCalledWith([video], { type: "video" });
  expect(mocks.create).toHaveBeenCalledWith({
    sessionId: "session",
    sourceAssetId: "uploaded-source",
  });
  await act(async () => {
    fireEvent.drop(
      screen.getByLabelText("Upload reference images").closest("label")!,
      { dataTransfer: { files: images, types: ["Files"] } },
    );
  });
  expect(mocks.upload).toHaveBeenCalledWith(images, { type: "image" });
});

it("shows each uploaded image with its own thumbnail and inserts it into the prompt when clicked", async () => {
  mocks.session = {
    _id: "session",
    storageScopeId: "scope",
    title: "Image test",
  };
  mocks.assets = [
    {
      _id: "a",
      name: "fc794a36-c29a-4f89-abd6-cc30aa5499b9.png",
      type: "image",
    },
    {
      _id: "b",
      name: "3bed9f08-38b9-4314-92be-16e07c6bafe3.png",
      type: "image",
    },
  ];
  mocks.urls = [
    { assetId: "a", url: "https://fixture.test/a.png" },
    { assetId: "b", url: "https://fixture.test/b.png" },
  ];
  show("/remix/session");
  expect(
    screen.getByRole("img", { name: mocks.assets[0]!.name }),
  ).toHaveAttribute("src", mocks.urls[0]!.url);
  expect(
    screen.getByRole("img", { name: mocks.assets[1]!.name }),
  ).toHaveAttribute("src", mocks.urls[1]!.url);
  await act(async () => {
    fireEvent.click(
      screen.getByRole("button", {
        name: `Insert reference ${mocks.assets[0]!.name}`,
      }),
    );
  });
  expect(screen.getByLabelText("Describe the change")).toHaveValue(
    "@fc794a36-c29a-4f89-abd6-cc30aa5499b9_png ",
  );
  expect(mocks.create).toHaveBeenCalledWith(
    expect.objectContaining({
      alias: "fc794a36-c29a-4f89-abd6-cc30aa5499b9_png",
      assetId: "a",
    }),
  );
});

it("shows one selected source with removal, then restores the upload area after removal", async () => {
  mocks.assets = [{ _id: "source", name: "Source.mp4", type: "video" }];
  mocks.session = {
    _id: "session",
    storageScopeId: "scope",
    title: "Removal",
    sourceAssetId: "source",
  };
  mocks.remove.mockImplementation(async () => {
    mocks.session = {
      ...mocks.session!,
      sourceAssetId: undefined,
      removedInputAssetIds: ["source"],
    };
  });
  const view = show("/remix/session");
  expect(
    screen.queryByLabelText("Upload source video"),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("combobox", { name: "Source video" }),
  ).not.toBeInTheDocument();
  await act(async () => {
    fireEvent.click(
      screen.getByRole("button", { name: "Remove source video" }),
    );
  });
  expect(mocks.remove).toHaveBeenCalledWith({
    sessionId: "session",
    assetId: "source",
  });
  view.refresh();
  expect(screen.getByLabelText("Upload source video")).toBeInTheDocument();
});
it("removes a reference image from the grid without removing other images", async () => {
  mocks.assets = [
    { _id: "a", name: "Actor.png", type: "image" },
    { _id: "b", name: "Style.png", type: "image" },
  ];
  mocks.session = { _id: "session", storageScopeId: "scope", title: "Images" };
  mocks.remove.mockImplementation(async () => {
    mocks.session = { ...mocks.session!, removedInputAssetIds: ["a"] };
  });
  const view = show("/remix/session");
  await act(async () => {
    fireEvent.click(
      screen.getByRole("button", { name: "Remove reference Actor.png" }),
    );
  });
  expect(mocks.remove).toHaveBeenCalledWith({
    sessionId: "session",
    assetId: "a",
  });
  view.refresh();
  expect(
    screen.queryByRole("button", { name: "Insert reference Actor.png" }),
  ).not.toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: "Insert reference Style.png" }),
  ).toBeInTheDocument();
});

it("filters real sessions by header search and switches to list view", () => {
  mocks.sessions = [
    { _id: "a", title: "Desert passage", updatedAt: 1 },
    { _id: "b", title: "City after dark", updatedAt: 2 },
  ];
  show("/remix?q=desert");
  expect(
    screen.getByRole("heading", { name: "Desert passage" }),
  ).toBeInTheDocument();
  expect(
    screen.queryByRole("heading", { name: "City after dark" }),
  ).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "List view" }));
  expect(screen.getByRole("button", { name: "List view" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
});
