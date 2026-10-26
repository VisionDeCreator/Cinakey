import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { MediaDropzone } from "./MediaDropzone";
afterEach(cleanup);
const video = () => new File(["video"], "source.mp4", { type: "video/mp4" });
const image = (name = "reference.png") =>
  new File(["image"], name, { type: "image/png" });
const transfer = (files: File[]) => ({
  files,
  types: ["Files"],
  dropEffect: "none",
});
it("uses the same upload callback for source drops and file selection", async () => {
  const upload = vi.fn().mockResolvedValue(undefined);
  render(
    <MediaDropzone type="video" onFiles={upload}>
      Source
    </MediaDropzone>,
  );
  const input = screen.getByLabelText("Upload source video");
  const file = video();
  await act(async () => {
    fireEvent.drop(input.closest("label")!, { dataTransfer: transfer([file]) });
  });
  expect(upload).toHaveBeenLastCalledWith([file]);
  await act(async () => {
    fireEvent.change(input, { target: { files: [file] } });
  });
  expect(upload).toHaveBeenCalledTimes(2);
});
it("accepts multiple reference images and keeps drag feedback active across child boundaries", async () => {
  const upload = vi.fn().mockResolvedValue(undefined);
  render(
    <MediaDropzone type="image" onFiles={upload}>
      <strong>References</strong>
    </MediaDropzone>,
  );
  const zone = screen
    .getByLabelText("Upload reference images")
    .closest("label")!;
  const files = [image(), image("second.png")];
  const dataTransfer = transfer(files);
  fireEvent.dragEnter(zone, { dataTransfer });
  fireEvent.dragEnter(screen.getByText("References"), { dataTransfer });
  fireEvent.dragLeave(screen.getByText("References"), { dataTransfer });
  expect(zone).toHaveClass("genjutsu-upload-dragging");
  await act(async () => {
    fireEvent.drop(zone, { dataTransfer });
  });
  expect(upload).toHaveBeenCalledWith(files);
  expect(zone).not.toHaveClass("genjutsu-upload-dragging");
});
it("rejects wrong media types and multiple source videos instead of uploading them", async () => {
  const upload = vi.fn();
  const { rerender } = render(
    <MediaDropzone type="video" onFiles={upload}>
      Source
    </MediaDropzone>,
  );
  let zone = screen.getByLabelText("Upload source video").closest("label")!;
  await act(async () => {
    fireEvent.drop(zone, { dataTransfer: transfer([image()]) });
  });
  expect(screen.getByRole("alert")).toHaveTextContent("video file");
  await act(async () => {
    fireEvent.drop(zone, { dataTransfer: transfer([video(), video()]) });
  });
  expect(screen.getByRole("alert")).toHaveTextContent("one source video");
  rerender(
    <MediaDropzone type="image" onFiles={upload}>
      Images
    </MediaDropzone>,
  );
  zone = screen.getByLabelText("Upload reference images").closest("label")!;
  await act(async () => {
    fireEvent.drop(zone, { dataTransfer: transfer([image(), video()]) });
  });
  expect(screen.getByRole("alert")).toHaveTextContent("only supported image");
  expect(upload).not.toHaveBeenCalled();
});
it("ignores drops while disabled and prevents the browser or a parent from opening the files", async () => {
  const upload = vi.fn();
  const parentDrop = vi.fn();
  render(
    <div onDrop={parentDrop}>
      <MediaDropzone disabled type="video" onFiles={upload}>
        Source
      </MediaDropzone>
    </div>,
  );
  const zone = screen.getByLabelText("Upload source video").closest("label")!;
  let allowed = true;
  await act(async () => {
    allowed = fireEvent.drop(zone, { dataTransfer: transfer([video()]) });
  });
  expect(allowed).toBe(false);
  expect(parentDrop).not.toHaveBeenCalled();
  expect(upload).not.toHaveBeenCalled();
});
