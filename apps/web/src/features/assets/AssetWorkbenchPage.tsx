import { api } from "@cinakey/backend";
import type { AssetSheetType } from "@cinakey/shared";
import { useMutation, useQuery } from "convex/react";
import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Input } from "@/components/ui/input";
import { useCopilotContext } from "@/features/copilot/CopilotContext";
import { PromptWorkbench } from "@/features/prompt-workbench/PromptWorkbench";

function entityKindToSheetType(
  kind: string,
): AssetSheetType {
  if (kind === "creature") return "creature";
  if (kind === "location") return "environment";
  if (kind === "prop") return "product";
  return "character";
}

export function AssetWorkbenchPage() {
  const { projectId, assetId } = useParams();
  const { setContext } = useCopilotContext();
  const entity = useQuery(
    api.entities.get,
    assetId ? { entityId: assetId as never } : "skip",
  );
  const tip = useQuery(
    api.promptSheets.getTipForEntity,
    assetId ? { entityId: assetId as never } : "skip",
  );
  const rename = useMutation(api.entities.update);

  const [name, setName] = useState("");
  const [assetType, setAssetType] = useState<AssetSheetType>("character");

  useEffect(() => {
    if (projectId && assetId) {
      setContext({
        view: "assets",
        projectId,
        selectionIds: [assetId],
      });
    }
  }, [projectId, assetId, setContext]);

  useEffect(() => {
    if (entity) {
      setName(entity.name);
      setAssetType(entityKindToSheetType(entity.kind));
    }
  }, [entity]);

  useEffect(() => {
    if (
      tip?.type === "character" ||
      tip?.type === "creature" ||
      tip?.type === "environment" ||
      tip?.type === "product"
    ) {
      setAssetType(tip.type);
    }
  }, [tip?.type]);

  if (!projectId || !assetId) return null;
  if (entity === undefined) {
    return <p className="text-sm text-zinc-500">Loading…</p>;
  }
  if (entity === null) {
    return <p className="text-sm text-zinc-500">Asset not found.</p>;
  }

  return (
    <div className="flex h-full min-h-[28rem] flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <Link
          to={`/projects/${projectId}/assets`}
          className="text-xs text-zinc-500 hover:text-zinc-300"
        >
          ← Assets
        </Link>
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => {
            const trimmed = name.trim();
            if (trimmed && trimmed !== entity.name) {
              void rename({
                entityId: assetId as never,
                name: trimmed,
              });
            }
          }}
          className="h-8 max-w-xs text-sm font-medium"
        />
      </div>
      <PromptWorkbench
        projectId={projectId}
        entityId={assetId}
        entityName={name || entity.name}
        assetType={assetType}
        onTypeDetected={setAssetType}
      />
    </div>
  );
}
