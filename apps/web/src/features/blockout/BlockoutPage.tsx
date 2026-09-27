import { api } from "@cinakey/backend";
import { estimateSceneDurationSec } from "@cinakey/shared";
import { useAction, useMutation, useQuery } from "convex/react";
import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ExportDialog } from "@/features/blockout/export/ExportDialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useCopilotContext } from "@/features/copilot/CopilotContext";
import { ShotDetailDrawer } from "@/features/blockout/ShotDetailDrawer";
import {
  ShotListTable,
  type ShotListItem,
} from "@/features/blockout/ShotListTable";
import { StoryboardGrid } from "@/features/blockout/StoryboardGrid";
import { formatDuration } from "@/features/blockout/shotConstants";

export function BlockoutPage() {
  const { projectId } = useParams();
  const { setContext } = useCopilotContext();
  const scenes = useQuery(
    api.scenes.listForProject,
    projectId ? { projectId: projectId as never } : "skip",
  );
  const project = useQuery(
    api.projects.get,
    projectId ? { projectId: projectId as never } : "skip",
  );
  const createShot = useMutation(api.shots.create);
  const getContent = useAction(api.scriptVersions.getContent);
  const exportDocument = useAction(api.blockouts.exportDocument);
  const [exportScope, setExportScope] = useState<"scene" | "project" | null>(
    null,
  );

  const [sceneIdOverride, setSceneIdOverride] = useState<string | null>(null);
  const [openShotId, setOpenShotId] = useState<string | null>(null);
  const [view, setView] = useState<"list" | "storyboard">("list");
  const [scriptEstimateSec, setScriptEstimateSec] = useState<number | null>(
    null,
  );

  const sceneId = sceneIdOverride ?? scenes?.[0]?._id ?? null;

  const selectedScene = useMemo(
    () => (scenes ?? []).find((s) => s._id === sceneId) ?? null,
    [scenes, sceneId],
  );

  const shots = useQuery(
    api.shots.listByScene,
    sceneId ? { sceneId: sceneId as never } : "skip",
  ) as ShotListItem[] | undefined;

  const runtime = useQuery(
    api.shots.getSceneRuntime,
    sceneId ? { sceneId: sceneId as never } : "skip",
  );

  useEffect(() => {
    if (!projectId || !selectedScene) return;
    let cancelled = false;
    void getContent({ projectId: projectId as never })
      .then((result) => {
        if (cancelled || !result.document) return;
        const scene = result.document.scenes.find(
          (s) => s.id === selectedScene.elementId,
        );
        if (!scene) return;
        setScriptEstimateSec(
          scene.estimatedDurationSec ?? estimateSceneDurationSec(scene),
        );
      })
      .catch(() => {
        /* keep prior estimate */
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, selectedScene, getContent]);

  useEffect(() => {
    if (!projectId) return;
    const selectionIds: string[] = [];
    if (selectedScene) selectionIds.push(selectedScene.elementId);
    if (openShotId) selectionIds.push(openShotId);
    setContext({
      view: "blockout",
      projectId,
      selectionIds,
    });
  }, [projectId, selectedScene, openShotId, setContext]);

  if (!projectId) return null;

  const openShot = (shots ?? []).find((s) => s._id === openShotId) ?? null;
  const shotTotalSec = runtime?.shotTotalSec ?? 0;
  const deltaSec =
    scriptEstimateSec === null ? null : shotTotalSec - scriptEstimateSec;

  async function addShot() {
    if (!sceneId) return;
    const id = await createShot({
      projectId: projectId as never,
      sceneId: sceneId as never,
      shotType: "medium",
      durationSec: 4,
      cameraMove: "static",
    });
    setOpenShotId(id);
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 p-4 md:p-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-lg font-medium text-zinc-100">Blockout</h1>
          <p className="text-sm text-zinc-500">
            Plan shots and storyboard keyframes before generation.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Select
            value={sceneId ?? undefined}
            onValueChange={(v) => {
              setSceneIdOverride(v);
              setOpenShotId(null);
              setScriptEstimateSec(null);
            }}
          >
            <SelectTrigger className="h-8 w-[18rem]">
              <SelectValue placeholder="Select scene" />
            </SelectTrigger>
            <SelectContent>
              {(scenes ?? []).map((s) => (
                <SelectItem key={s._id} value={s._id}>
                  {s.heading}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button type="button" size="sm" variant="outline">
                <Download />
                Export
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                disabled={!sceneId}
                onSelect={() => setExportScope("scene")}
              >
                This scene
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setExportScope("project")}>
                Whole project
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button
            type="button"
            size="sm"
            disabled={!sceneId}
            onClick={() => void addShot()}
          >
            Add shot
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap gap-4 text-xs text-zinc-400">
        <span>
          Shot total:{" "}
          <span className="text-zinc-200">{formatDuration(shotTotalSec)}</span>
        </span>
        <span>
          Script estimate:{" "}
          <span className="text-zinc-200">
            {scriptEstimateSec === null
              ? "—"
              : formatDuration(scriptEstimateSec)}
          </span>
        </span>
        {deltaSec !== null ? (
          <span
            className={
              Math.abs(deltaSec) > 5 ? "text-amber-400" : "text-zinc-400"
            }
          >
            Delta: {deltaSec > 0 ? "+" : ""}
            {formatDuration(deltaSec)}
          </span>
        ) : null}
      </div>

      {!sceneId || (scenes && scenes.length === 0) ? (
        <p className="py-12 text-center text-sm text-zinc-500">
          Commit a script with scenes first, then build the shot list here.
        </p>
      ) : (
        <Tabs
          value={view}
          onValueChange={(v) => setView(v as "list" | "storyboard")}
          className="min-h-0 flex-1"
        >
          <TabsList>
            <TabsTrigger value="list">Shot list</TabsTrigger>
            <TabsTrigger value="storyboard">Storyboard</TabsTrigger>
          </TabsList>
          <TabsContent value="list" className="mt-3">
            <ShotListTable
              projectId={projectId}
              sceneId={sceneId}
              shots={shots ?? []}
              onOpenShot={setOpenShotId}
            />
          </TabsContent>
          <TabsContent value="storyboard" className="mt-3">
            <StoryboardGrid
              sceneId={sceneId}
              shots={shots ?? []}
              onOpenShot={setOpenShotId}
            />
          </TabsContent>
        </Tabs>
      )}

      <ExportDialog
        open={exportScope !== null}
        onOpenChange={(o) => {
          if (!o) setExportScope(null);
        }}
        scopeLabel={
          exportScope === "scene"
            ? `Scene: ${selectedScene?.heading ?? ""}`
            : "Whole project"
        }
        baseName={
          exportScope === "scene"
            ? `${project?.title ?? "blockout"}-sc${(selectedScene?.order ?? 0) + 1}`
            : (project?.title ?? "blockout")
        }
        multiShot
        loadDocument={async () => {
          const result = await exportDocument({
            projectId: projectId as never,
            ...(exportScope === "scene" && sceneId
              ? { sceneId: sceneId as never }
              : {}),
          });
          return {
            document: result.document,
            skippedCount: result.skippedShotIds.length,
          };
        }}
      />

      {sceneId ? (
        <ShotDetailDrawer
          projectId={projectId}
          sceneId={sceneId}
          sceneElementId={selectedScene?.elementId ?? null}
          shot={openShot}
          open={openShotId !== null}
          onOpenChange={(o) => {
            if (!o) setOpenShotId(null);
          }}
        />
      ) : null}
    </div>
  );
}
