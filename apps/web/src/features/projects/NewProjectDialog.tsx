import { api } from "@cinakey/backend";
import type { AspectRatio } from "@cinakey/shared";
import { useMutation } from "convex/react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

export function NewProjectDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const create = useMutation(api.projects.create);
  const navigate = useNavigate();
  const [title, setTitle] = useState("");
  const [logline, setLogline] = useState("");
  const [audience, setAudience] = useState("");
  const [tone, setTone] = useState("");
  const [targetLengthSec, setTargetLengthSec] = useState("30");
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>("16:9");
  const [fps, setFps] = useState("24");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setTitle("");
    setLogline("");
    setAudience("");
    setTone("");
    setTargetLengthSec("30");
    setAspectRatio("16:9");
    setFps("24");
    setError(null);
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim() || !logline.trim()) {
      setError("Title and logline are required.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const length = Number(targetLengthSec);
      const fpsNum = Number(fps);
      const id = await create({
        title: title.trim(),
        brief: {
          logline: logline.trim(),
          audience: audience.trim() || undefined,
          tone: tone.trim() || undefined,
        },
        aspectRatio,
        fps: Number.isFinite(fpsNum) ? fpsNum : 24,
        targetLengthSec: Number.isFinite(length) ? length : undefined,
      });
      reset();
      onOpenChange(false);
      void navigate(`/projects/${id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create project");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!busy) {
          if (!next) reset();
          onOpenChange(next);
        }
      }}
    >
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <form onSubmit={(e) => void onSubmit(e)}>
          <DialogHeader>
            <DialogTitle>New project</DialogTitle>
            <DialogDescription>
              Start from a brief. You can refine the script and look next.
            </DialogDescription>
          </DialogHeader>

          <div className="mt-4 grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor="title">Title</Label>
              <Input
                id="title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Working title"
                required
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="logline">Logline</Label>
              <Textarea
                id="logline"
                value={logline}
                onChange={(e) => setLogline(e.target.value)}
                placeholder="One or two sentences about the story"
                required
              />
            </div>
            <div className="grid gap-2 sm:grid-cols-2 sm:gap-3">
              <div className="grid gap-2">
                <Label htmlFor="audience">Audience</Label>
                <Input
                  id="audience"
                  value={audience}
                  onChange={(e) => setAudience(e.target.value)}
                  placeholder="Who is this for?"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="tone">Tone</Label>
                <Input
                  id="tone"
                  value={tone}
                  onChange={(e) => setTone(e.target.value)}
                  placeholder="e.g. warm, tense"
                />
              </div>
            </div>
            <div className="grid gap-2 sm:grid-cols-3 sm:gap-3">
              <div className="grid gap-2">
                <Label htmlFor="length">Target length (sec)</Label>
                <Input
                  id="length"
                  type="number"
                  min={1}
                  value={targetLengthSec}
                  onChange={(e) => setTargetLengthSec(e.target.value)}
                />
              </div>
              <div className="grid gap-2">
                <Label>Aspect ratio</Label>
                <Select
                  value={aspectRatio}
                  onValueChange={(v) => setAspectRatio(v as AspectRatio)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="16:9">16:9</SelectItem>
                    <SelectItem value="9:16">9:16</SelectItem>
                    <SelectItem value="1:1">1:1</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="fps">FPS</Label>
                <Input
                  id="fps"
                  type="number"
                  min={1}
                  value={fps}
                  onChange={(e) => setFps(e.target.value)}
                />
              </div>
            </div>
            {error ? <p className="text-sm text-red-400">{error}</p> : null}
          </div>

          <DialogFooter className="mt-6">
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? "Creating…" : "Create project"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
