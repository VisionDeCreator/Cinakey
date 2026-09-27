import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";

type Props = {
  onCancel: () => void;
  onSave: (blob: Blob) => void;
};

/** Minimal freehand sketch pad for storyboard keyframes. */
export function KeyframeSketch({ onCancel, onSave }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [brush, setBrush] = useState(4);
  const drawing = useRef(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = 640;
    canvas.height = 360;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.fillStyle = "#1a1a1a";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }, []);

  const paint = useCallback(
    (clientX: number, clientY: number) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const x = ((clientX - rect.left) / rect.width) * canvas.width;
      const y = ((clientY - rect.top) / rect.height) * canvas.height;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.fillStyle = "#e4e4e7";
      ctx.beginPath();
      ctx.arc(x, y, brush / 2, 0, Math.PI * 2);
      ctx.fill();
    },
    [brush],
  );

  function clear() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.fillStyle = "#1a1a1a";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

  function save() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.toBlob((blob) => {
      if (blob) onSave(blob);
    }, "image/png");
  }

  return (
    <div className="space-y-3 rounded border border-zinc-700 bg-zinc-900/50 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-zinc-300">Sketch a keyframe</p>
        <div className="flex items-center gap-2 text-xs text-zinc-400">
          <label>
            Brush
            <input
              type="range"
              min={2}
              max={24}
              value={brush}
              onChange={(e) => setBrush(Number(e.target.value))}
              className="ml-2 align-middle"
            />
          </label>
          <Button type="button" size="sm" variant="ghost" onClick={clear}>
            Clear
          </Button>
        </div>
      </div>
      <canvas
        ref={canvasRef}
        className="mx-auto block w-full max-w-lg touch-none border border-zinc-800"
        onPointerDown={(e) => {
          drawing.current = true;
          (e.target as HTMLCanvasElement).setPointerCapture(e.pointerId);
          paint(e.clientX, e.clientY);
        }}
        onPointerMove={(e) => {
          if (!drawing.current) return;
          paint(e.clientX, e.clientY);
        }}
        onPointerUp={() => {
          drawing.current = false;
        }}
      />
      <div className="flex gap-2">
        <Button type="button" size="sm" onClick={save}>
          Use sketch
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
