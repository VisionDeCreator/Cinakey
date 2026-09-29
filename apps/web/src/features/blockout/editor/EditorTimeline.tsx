import type { BlockoutDocument } from "@cinakey/shared";
import { Pause, Play, SkipBack, SkipForward } from "lucide-react";
import { useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { formatTimecode, type SelKey } from "./editorModel";
import { cn } from "@/lib/utils";

type Props = {
  doc: BlockoutDocument;
  frame: number;
  playing: boolean;
  selectedKey: SelKey | null;
  onFrame: (f: number) => void;
  onTogglePlay: () => void;
  onSelectKey: (k: SelKey | null) => void;
};

type TlRow = { id: string; name: string; color: string };

function tlRows(doc: BlockoutDocument): TlRow[] {
  return [
    { id: "cam", name: "Camera", color: "#e6a23c" },
    ...doc.objects
      .filter(
        (o) =>
          o.keys.length ||
          o.type === "character" ||
          o.type === "creature" ||
          o.type === "hare" ||
          o.type === "raptor" ||
          o.type === "car",
      )
      .map((o) => ({ id: o.id, name: o.name, color: o.color })),
  ];
}

export function EditorTimeline({
  doc,
  frame,
  playing,
  selectedKey,
  onFrame,
  onTogglePlay,
  onSelectKey,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const rows = tlRows(doc);
  const rulerH = 22;
  const rowH = 24;
  const pad = 12;

  useEffect(() => {
    const c = canvasRef.current;
    const wrap = wrapRef.current;
    if (!c || !wrap) return;

    const draw = () => {
      const w = wrap.clientWidth;
      const h = rulerH + rows.length * rowH + 4;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      c.width = Math.max(1, w * dpr);
      c.height = h * dpr;
      c.style.height = `${h}px`;
      const g = c.getContext("2d");
      if (!g || !w) return;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, w, h);

      const F = Math.max(1, doc.frames);
      const fps = doc.fps;
      const fx = (f: number) => pad + (f * (w - 2 * pad)) / F;

      g.fillStyle = "#12161b";
      g.fillRect(0, 0, w, rulerH);
      g.font = '11px "IBM Plex Mono", ui-monospace, monospace';
      g.textBaseline = "middle";
      for (let f = 0; f <= F; f++) {
        const x = Math.round(fx(f)) + 0.5;
        const sec = f % fps === 0;
        const half = f % Math.max(1, Math.floor(fps / 2)) === 0;
        g.strokeStyle = sec ? "#5a6474" : half ? "#3a424e" : "#2a313a";
        g.beginPath();
        g.moveTo(x, rulerH - (sec ? 12 : half ? 8 : 4));
        g.lineTo(x, rulerH);
        g.stroke();
        if (sec) {
          g.fillStyle = "#9aa3b2";
          g.textAlign = "center";
          g.fillText(String(f / fps) + "s", x, 10);
        }
      }

      // cut markers
      for (const cut of doc.shots) {
        const x0 = fx(cut.start);
        const x1 = fx(cut.end);
        g.fillStyle = "rgba(230,162,60,.12)";
        g.fillRect(x0, rulerH, x1 - x0, h - rulerH);
        g.strokeStyle = "rgba(230,162,60,.55)";
        g.beginPath();
        g.moveTo(Math.round(x0) + 0.5, 0);
        g.lineTo(Math.round(x0) + 0.5, h);
        g.stroke();
        g.fillStyle = "#e6a23c";
        g.font = '600 10px "IBM Plex Sans", sans-serif';
        g.textAlign = "left";
        g.fillText(`S${cut.n}`, x0 + 4, rulerH + 10);
      }

      rows.forEach((row, ri) => {
        const y = rulerH + ri * rowH;
        g.fillStyle = ri % 2 ? "#0e1217" : "#0b0e12";
        g.fillRect(0, y, w, rowH);
        g.strokeStyle = "#1c222a";
        g.beginPath();
        g.moveTo(0, y + rowH + 0.5);
        g.lineTo(w, y + rowH + 0.5);
        g.stroke();

        if (row.id === "cam") {
          for (const k of doc.camera.keys) {
            drawDiamond(
              g,
              fx(k.f),
              y + rowH / 2,
              k.ease === "hold",
              isSel(selectedKey, "cam", k.id),
            );
          }
        } else {
          const o = doc.objects.find((x) => x.id === row.id);
          if (!o) return;
          for (const k of o.keys) {
            drawDiamond(
              g,
              fx(k.f),
              y + rowH / 2,
              k.ease === "hold",
              selectedKey?.kind === "obj" &&
                selectedKey.objectId === o.id &&
                selectedKey.f === k.f,
            );
          }
        }
      });

      // playhead
      const px = Math.round(fx(frame)) + 0.5;
      g.strokeStyle = "#ef4444";
      g.lineWidth = 1.5;
      g.beginPath();
      g.moveTo(px, 0);
      g.lineTo(px, h);
      g.stroke();
      g.lineWidth = 1;
    };

    draw();
    const ro = new ResizeObserver(draw);
    ro.observe(wrap);
    return () => ro.disconnect();
  }, [doc, frame, rows, selectedKey]);

  const onPointer = (e: React.PointerEvent) => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const rect = wrap.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const w = rect.width;
    const F = Math.max(1, doc.frames);
    const f = Math.round(((x - pad) / (w - 2 * pad)) * F);
    const clamped = Math.max(0, Math.min(doc.frames, f));

    const y = e.clientY - rect.top;
    if (y > rulerH) {
      const ri = Math.floor((y - rulerH) / rowH);
      const row = rows[ri];
      if (row) {
        const hit = hitKey(doc, row.id, clamped, 3);
        if (hit) {
          onSelectKey(hit);
          onFrame(hit.kind === "cam" ? frameAtCam(doc, hit.id) : hit.f);
          return;
        }
      }
    }
    onFrame(clamped);
  };

  return (
    <div className="flex shrink-0 flex-col border-t border-zinc-800 bg-zinc-950">
      <div className="flex items-center gap-2 border-b border-zinc-800 px-2 py-1">
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="h-7 w-7 p-0"
          onClick={() => onFrame(0)}
          title="Home"
        >
          <SkipBack className="size-3.5" />
        </Button>
        <Button
          type="button"
          size="sm"
          variant={playing ? "default" : "outline"}
          className="h-7 min-w-[4.25rem] gap-1 px-2"
          onClick={onTogglePlay}
          title="Play / pause (Space)"
        >
          {playing ? (
            <Pause className="size-3.5" />
          ) : (
            <Play className="size-3.5" />
          )}
          {playing ? "Pause" : "Play"}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="h-7 w-7 p-0"
          onClick={() => onFrame(doc.frames)}
          title="End"
        >
          <SkipForward className="size-3.5" />
        </Button>
        <span className="font-mono text-[11px] text-zinc-400">
          {formatTimecode(frame, doc.fps)}
        </span>
        <span className="font-mono text-[11px] text-zinc-600">
          F {String(frame).padStart(3, "0")} / {doc.frames}
        </span>
      </div>
      <div className="flex min-h-0">
        <div className="w-28 shrink-0 border-r border-zinc-800 text-[10px] text-zinc-400">
          <div className="flex h-[22px] items-center px-2 text-zinc-600">
            tracks
          </div>
          {rows.map((r) => (
            <div
              key={r.id}
              className="flex h-6 items-center gap-1.5 px-2"
              style={{ height: rowH }}
            >
              <span
                className="inline-block size-2 shrink-0 rounded-sm"
                style={{ background: r.color }}
              />
              <span className="truncate">{r.name}</span>
            </div>
          ))}
        </div>
        <div ref={wrapRef} className="min-w-0 flex-1 overflow-hidden">
          <canvas
            ref={canvasRef}
            className={cn("block w-full cursor-ew-resize")}
            onPointerDown={onPointer}
            onPointerMove={(e) => {
              if (e.buttons === 1) onPointer(e);
            }}
          />
        </div>
      </div>
    </div>
  );
}

function drawDiamond(
  g: CanvasRenderingContext2D,
  x: number,
  y: number,
  hold: boolean,
  sel: boolean,
) {
  const s = sel ? 6 : 5;
  g.beginPath();
  g.moveTo(x, y - s);
  g.lineTo(x + s, y);
  g.lineTo(x, y + s);
  g.lineTo(x - s, y);
  g.closePath();
  if (hold) {
    g.fillStyle = "#0b0e12";
    g.fill();
    g.strokeStyle = sel ? "#fafafa" : "#e6a23c";
    g.stroke();
  } else {
    g.fillStyle = sel ? "#fafafa" : "#e6a23c";
    g.fill();
  }
}

function isSel(sel: SelKey | null, track: string, id: string) {
  return track === "cam" && sel?.kind === "cam" && sel.id === id;
}

function frameAtCam(doc: BlockoutDocument, id: string) {
  return doc.camera.keys.find((k) => k.id === id)?.f ?? 0;
}

function hitKey(
  doc: BlockoutDocument,
  trackId: string,
  frame: number,
  tol: number,
): SelKey | null {
  if (trackId === "cam") {
    const k = doc.camera.keys.find((x) => Math.abs(x.f - frame) <= tol);
    return k ? { kind: "cam", id: k.id } : null;
  }
  const o = doc.objects.find((x) => x.id === trackId);
  if (!o) return null;
  const k = o.keys.find((x) => Math.abs(x.f - frame) <= tol);
  return k ? { kind: "obj", objectId: o.id, f: k.f } : null;
}
