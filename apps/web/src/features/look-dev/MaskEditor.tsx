import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";

type Props = {
  imageUrl: string;
  onCancel: () => void;
  onApply: (maskBlob: Blob) => void;
};

/**
 * Simple brush mask editor. White = edit region for OpenAI inpaint.
 */
export function MaskEditor({ imageUrl, onCancel, onApply }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [brush, setBrush] = useState(24);
  const drawing = useRef(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      const max = 512;
      const scale = Math.min(1, max / Math.max(img.width, img.height));
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.fillStyle = "#000000";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      setReady(true);
    };
    img.src = imageUrl;
  }, [imageUrl]);

  const paint = useCallback(
    (clientX: number, clientY: number) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const x = ((clientX - rect.left) / rect.width) * canvas.width;
      const y = ((clientY - rect.top) / rect.height) * canvas.height;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.fillStyle = "#ffffff";
      ctx.beginPath();
      ctx.arc(x, y, brush / 2, 0, Math.PI * 2);
      ctx.fill();
    },
    [brush],
  );

  function clearMask() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.fillStyle = "#000000";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

  function apply() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.toBlob((blob) => {
      if (blob) onApply(blob);
    }, "image/png");
  }

  return (
    <div className="space-y-3 rounded border border-zinc-700 bg-zinc-900/50 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-zinc-300">
          Paint the region to edit (white = change)
        </p>
        <div className="flex items-center gap-2 text-xs text-zinc-400">
          <label>
            Brush
            <input
              type="range"
              min={8}
              max={64}
              value={brush}
              onChange={(e) => setBrush(Number(e.target.value))}
              className="ml-2 align-middle"
            />
          </label>
          <Button type="button" size="sm" variant="ghost" onClick={clearMask}>
            Clear
          </Button>
        </div>
      </div>
      <div className="relative mx-auto max-w-md overflow-hidden border border-zinc-800">
        <img
          src={imageUrl}
          alt="Base"
          className="block w-full opacity-60"
          draggable={false}
        />
        <canvas
          ref={canvasRef}
          className="absolute inset-0 h-full w-full cursor-crosshair mix-blend-screen opacity-80"
          onPointerDown={(e) => {
            drawing.current = true;
            (e.target as HTMLCanvasElement).setPointerCapture(e.pointerId);
            paint(e.clientX, e.clientY);
          }}
          onPointerMove={(e) => {
            if (drawing.current) paint(e.clientX, e.clientY);
          }}
          onPointerUp={() => {
            drawing.current = false;
          }}
        />
      </div>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="button" disabled={!ready} onClick={apply}>
          Use mask &amp; generate
        </Button>
      </div>
    </div>
  );
}
