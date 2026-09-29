import JSZip from "jszip";
import type { BlockoutDocument } from "@cinakey/shared";
import { encodePartToMp4, type VideoProgress } from "./videoExport";

export type ExportOptions = {
  json: boolean;
  mp4: boolean;
  burnIn: boolean;
  mode: "clay" | "depth";
  /** Whole part or current shot cut range. */
  range: "part" | "shot";
  shotStart?: number;
  shotEnd?: number;
};

export type ExportProgress = { label: string; fraction: number };

export function slugify(text: string): string {
  return (
    text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "blockout"
  );
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export function documentToJsonBlob(doc: BlockoutDocument): Blob {
  return new Blob([JSON.stringify(doc, null, 2)], { type: "application/json" });
}

export async function runExport(input: {
  document: BlockoutDocument;
  baseName: string;
  options: ExportOptions;
  signal: AbortSignal;
  onProgress: (p: ExportProgress) => void;
}): Promise<void> {
  const { document: doc, options, signal, onProgress } = input;
  const files: Array<{ name: string; blob: Blob }> = [];
  const base = slugify(input.baseName);

  if (options.json) {
    files.push({
      name: `${base}.cinakey.blockout.json`,
      blob: documentToJsonBlob(doc),
    });
  }

  if (options.mp4) {
    const range =
      options.range === "shot" &&
      options.shotStart != null &&
      options.shotEnd != null
        ? { start: options.shotStart, end: options.shotEnd }
        : undefined;
    const blob = await encodePartToMp4({
      document: doc,
      range,
      burnIn: options.burnIn,
      mode: options.mode,
      signal,
      onProgress: (p: VideoProgress) => {
        onProgress({
          label: `Rendering frame ${p.frame} of ${p.totalFrames}`,
          fraction: p.totalFrames ? p.frame / p.totalFrames : 1,
        });
      },
    });
    files.push({ name: `${base}.mp4`, blob });
  }

  if (signal.aborted) throw new DOMException("Export cancelled", "AbortError");
  if (files.length === 1) {
    downloadBlob(files[0]!.blob, files[0]!.name);
  } else if (files.length > 1) {
    onProgress({ label: "Packaging zip", fraction: 1 });
    const zip = new JSZip();
    for (const f of files) zip.file(f.name, f.blob);
    downloadBlob(await zip.generateAsync({ type: "blob" }), `${base}.zip`);
  }
}

/** Encode whole-part MP4 for pre-viz upload (no burn-in, clay). */
export async function encodePrevizMp4(input: {
  document: BlockoutDocument;
  signal: AbortSignal;
  onProgress: (p: ExportProgress) => void;
}): Promise<Blob> {
  return encodePartToMp4({
    document: input.document,
    burnIn: false,
    mode: "clay",
    signal: input.signal,
    onProgress: (p) => {
      input.onProgress({
        label: `Rendering frame ${p.frame} of ${p.totalFrames}`,
        fraction: p.totalFrames ? p.frame / p.totalFrames : 1,
      });
    },
  });
}
