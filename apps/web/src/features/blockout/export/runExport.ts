import JSZip from "jszip";
import {
  tracksFromShot,
  type BlockoutDocument,
  type BlockoutScene,
  type BlockoutShot,
} from "@cinakey/shared";
import { parseAspect } from "@/features/blockout/editor/runtime/shotRenderer";
import { encodeClipsToMp4, type VideoClip, type VideoProgress } from "./videoExport";

export type ExportOptions = {
  json: boolean;
  mp4: boolean;
  burnIn: boolean;
  /** One MP4 for everything, or one MP4 per shot. */
  mode: "sequence" | "per-shot";
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

function clipFor(scene: BlockoutScene, shot: BlockoutShot): VideoClip {
  return {
    shot: {
      nodes: shot.scene.nodes,
      cameraNodeId: shot.camera.nodeId,
      tracks: tracksFromShot(shot),
      durationSec: shot.durationSec,
      lensMm: shot.lensMm,
    },
    shotLabel: `SC ${scene.order + 1} / SH ${shot.order + 1}`,
    sceneLabel: scene.heading ?? "",
  };
}

function clipFileName(scene: BlockoutScene, shot: BlockoutShot): string {
  return `sc${String(scene.order + 1).padStart(2, "0")}-sh${String(shot.order + 1).padStart(2, "0")}.mp4`;
}

/** Produce the requested files and trigger one download (zip when >1 file). */
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
    files.push({ name: `${base}.cinakey.blockout.json`, blob: documentToJsonBlob(doc) });
  }

  if (options.mp4) {
    const pairs = doc.scenes.flatMap((scene) => scene.shots.map((shot) => ({ scene, shot })));
    if (pairs.length === 0) throw new Error("Nothing to render: no blocked-out shots");
    const fps = doc.project.fps;
    const aspect = parseAspect(doc.project.aspectRatio);
    const groups =
      options.mode === "sequence"
        ? [{ name: `${base}.mp4`, items: pairs }]
        : pairs.map((p) => ({ name: clipFileName(p.scene, p.shot), items: [p] }));
    for (const [gi, group] of groups.entries()) {
      const blob = await encodeClipsToMp4({
        clips: group.items.map((p) => clipFor(p.scene, p.shot)),
        fps,
        aspect,
        burnIn: options.burnIn,
        signal,
        onProgress: (p: VideoProgress) => {
          const within = p.totalFrames ? p.frame / p.totalFrames : 1;
          onProgress({
            label:
              groups.length > 1
                ? `Rendering clip ${gi + 1} of ${groups.length} (frame ${p.frame}/${p.totalFrames})`
                : `Rendering frame ${p.frame} of ${p.totalFrames}`,
            fraction: (gi + within) / groups.length,
          });
        },
      });
      files.push({ name: group.name, blob });
    }
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
