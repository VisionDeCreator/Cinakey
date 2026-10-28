import { I18nText, t, useLocale } from "@cinakey/ui/i18n";
import { Input } from "@/components/ui/input";
import { PromptWorkbench } from "@/features/prompt-workbench/PromptWorkbench";
import { useMutation, useQuery } from "@/lib/api/hooks";
import { api } from "@cinakey/backend";
import type { AssetSheetType } from "@cinakey/shared";
import { useState } from "react";
import { Link, useParams } from "react-router-dom";

function entityKindToSheetType(kind: string): AssetSheetType {
  if (kind === "creature") return "creature";
  if (kind === "location") return "environment";
  if (kind === "prop") return "product";
  return "character";
}

export function AssetWorkbenchPage() {
  useLocale();
  const { projectId, assetId } = useParams();
  const entity = useQuery(
    api.entities.get,
    assetId ? { entityId: assetId as never } : "skip",
  );
  const rename = useMutation(api.entities.update);

  const [draft, setDraft] = useState<{ entityId: string; name: string } | null>(
    null,
  );
  const name =
    draft && draft.entityId === assetId ? draft.name : (entity?.name ?? "");
  const assetType = entityKindToSheetType(entity?.kind ?? "character");
  if (!projectId || !assetId) return null;
  if (entity === undefined) {
    return (
      <p className="text-sm text-zinc-500">
        <I18nText text="Loading…" />
      </p>
    );
  }
  if (entity === null) {
    return (
      <p className="text-sm text-zinc-500">
        <I18nText text="Asset not found." />
      </p>
    );
  }

  return (
    <div className="flex h-full min-h-[28rem] flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <Link
          to={`/projects/${projectId}/assets`}
          className="text-xs text-zinc-500 hover:text-zinc-300"
        >
          <I18nText text="← References" />
        </Link>
        <Input
          value={name}
          onChange={(e) =>
            setDraft({ entityId: assetId, name: e.target.value })
          }
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
        <select
          aria-label={t("Reference type")}
          value={entity.kind}
          className="h-8 border border-zinc-700 bg-zinc-900 px-2 text-sm"
          onChange={(e) => {
            const kind = e.target.value as
              "character" | "creature" | "location" | "prop";
            void rename({ entityId: assetId as never, kind });
          }}
        >
          <option value="character">
            <I18nText text="Character" />
          </option>
          <option value="creature">
            <I18nText text="Creature" />
          </option>
          <option value="location">
            <I18nText text="Location" />
          </option>
          <option value="prop">
            <I18nText text="Prop / product" />
          </option>
        </select>
      </div>
      <PromptWorkbench
        projectId={projectId}
        entityId={assetId}
        entityName={name || entity.name}
        assetType={assetType}
      />
    </div>
  );
}
