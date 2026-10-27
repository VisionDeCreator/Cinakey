import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import { ShareWatchPage } from "./ShareWatchPage";
const mount = () =>
  render(
    <MemoryRouter initialEntries={["/share/link"]}>
      <Routes>
        <Route path="/share/:linkId" element={<ShareWatchPage />} />
      </Routes>
    </MemoryRouter>,
  );
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState(null, "", "/");
});
it("opens a signed-out watch page with scoped cookies and no credential in the media URL", async () => {
  window.history.replaceState(null, "", `/#${"a".repeat(64)}`);
  const send = vi
    .fn()
    .mockResolvedValueOnce(new Response("{}", { status: 200 }))
    .mockResolvedValueOnce(
      new Response(
        JSON.stringify({ title: "Client film", allowDownload: false }),
        { status: 200 },
      ),
    );
  vi.stubGlobal("fetch", send);
  const { container } = mount();
  fireEvent.click(screen.getByRole("button", { name: "Open video" }));
  expect(
    await screen.findByRole("heading", { name: "Client film" }),
  ).toBeInTheDocument();
  expect(send.mock.calls[0]![0]).toMatch(/\/public\/shares\/link\/session$/);
  expect(JSON.parse(send.mock.calls[0]![1].body)).toEqual({
    secret: "a".repeat(64),
    password: "",
  });
  expect(send.mock.calls[0]![1].credentials).toBe("include");
  expect(container.querySelector("video")?.getAttribute("src")).toMatch(
    /\/link\/media$/,
  );
  expect(container.querySelector("video")?.getAttribute("crossorigin")).toBe(
    "use-credentials",
  );
  expect(
    screen.queryByRole("link", { name: "Download MP4" }),
  ).not.toBeInTheDocument();
});
it("only shows a download link when explicitly allowed and handles revocation playback errors", async () => {
  window.history.replaceState(null, "", `/#${"a".repeat(64)}`);
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValueOnce(new Response("{}"))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ title: "Film", allowDownload: true })),
      ),
  );
  const { container } = mount();
  fireEvent.click(screen.getByRole("button", { name: "Open video" }));
  expect(
    await screen.findByRole("link", { name: "Download MP4" }),
  ).toHaveAttribute("href", expect.stringContaining("download=1"));
  fireEvent.error(container.querySelector("video")!);
  expect(screen.getByRole("alert")).toHaveTextContent("revoked");
  expect(
    screen.getByRole("button", { name: "Open video" }),
  ).toBeInTheDocument();
});
it("keeps invalid links/passwords closed and never renders a player", async () => {
  window.history.replaceState(null, "", "/#bad-secret");
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(new Response("{}", { status: 403 })),
  );
  const { container } = mount();
  fireEvent.change(screen.getByLabelText("Password (if required)"), {
    target: { value: "wrong" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Open video" }));
  await waitFor(() =>
    expect(screen.getByRole("alert")).toHaveTextContent(
      "invalid, expired or revoked",
    ),
  );
  expect(container.querySelector("video")).toBeNull();
});
it("requires a complete link and does not make an automatic access request", () => {
  const send = vi.fn();
  vi.stubGlobal("fetch", send);
  mount();
  expect(screen.getByRole("button", { name: "Open video" })).toBeDisabled();
  expect(send).not.toHaveBeenCalled();
});
