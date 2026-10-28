import { I18nText, t, useLocale } from "@cinakey/ui/i18n";
import { useState } from "react";
import { Box, UserRound, Lightbulb } from "lucide-react";
import { cn } from "@/lib/utils";
import type { BlockoutLightRole, BlockoutObjectType } from "@cinakey/shared";
import { LIGHT_ADD_ROLES, PROP_ADD_TYPES } from "./editorModel";
import { LIGHT_DEFAULTS } from "./runtime/objects";

type Entity = { id: string; name: string; kind: string };

type Props = {
  objects: Array<{ id: string; name: string; type: string }>;
  selectedId: string | null;
  onSelect: (id: string) => void;
  characters: Entity[];
  onAddCharacter: (entity?: Entity) => void;
  onAddProp: (type: BlockoutObjectType) => void;
  onAddLight: (role: BlockoutLightRole) => void;
};

function Chip({ label, onClick }: { label: string; onClick: () => void }) {
  useLocale();
  return (
    <button
      type="button"
      onClick={onClick}
      className="border border-zinc-800 px-2 py-1 text-left text-[11px] text-zinc-300 transition-colors hover:border-zinc-600 hover:bg-zinc-900 hover:text-zinc-100"
    >
      <Box aria-hidden="true" size={28} />
      {label}
    </button>
  );
}

export function EditorLibrary({
  characters,
  objects,
  selectedId,
  onSelect,
  onAddCharacter,
  onAddProp,
  onAddLight,
}: Props) {
  useLocale();
  const [category, setCategory] = useState("Characters");
  return (
    <aside
      aria-label={t("Scene library")}
      className="staging-editor-library flex w-44 shrink-0 flex-col gap-3 overflow-y-auto border-r border-zinc-800 bg-zinc-950 p-2 text-xs"
    >
      <h2>
        <I18nText text="Scene library" />
      </h2>
      <div className="staging-library-tabs">
        {["Characters", "Props", "Lights"].map((name) => (
          <button
            type="button"
            aria-pressed={category === name}
            key={name}
            onClick={() => setCategory(name)}
          >
            {t(name)}
          </button>
        ))}
      </div>
      <section hidden={category !== "Characters"}>
        <h3 className="mb-1.5 text-[10px] font-medium uppercase tracking-wide text-zinc-500">
          <I18nText text="Characters" />
        </h3>
        <div className="flex flex-col gap-1">
          {characters.map((c) => (
            <Chip key={c.id} label={c.name} onClick={() => onAddCharacter(c)} />
          ))}
          <Chip label={t("Untagged figure")} onClick={() => onAddCharacter()} />
        </div>
      </section>
      <section hidden={category !== "Props"}>
        <h3 className="mb-1.5 text-[10px] font-medium uppercase tracking-wide text-zinc-500">
          <I18nText text="Props" />
        </h3>
        <div className="flex flex-col gap-1">
          {PROP_ADD_TYPES.map((p) => (
            <Chip
              key={p.type}
              label={t(p.label)}
              onClick={() => onAddProp(p.type)}
            />
          ))}
        </div>
      </section>
      <section hidden={category !== "Lights"}>
        <h3 className="mb-1.5 text-[10px] font-medium uppercase tracking-wide text-zinc-500">
          <I18nText text="Lights" />
        </h3>
        <div className="flex flex-col gap-1">
          {LIGHT_ADD_ROLES.map((role) => (
            <Chip
              key={role}
              label={t(LIGHT_DEFAULTS[role].name)}
              onClick={() => onAddLight(role)}
            />
          ))}
        </div>
      </section>
      <section className="staging-scene-objects">
        <h3>
          <I18nText text="Scene objects" />
        </h3>
        {objects.length ? (
          objects.map((object) => (
            <button
              type="button"
              key={object.id}
              aria-pressed={selectedId === object.id}
              onClick={() => onSelect(object.id)}
            >
              {object.type === "light" ? (
                <Lightbulb size={16} />
              ) : object.type === "character" || object.type === "creature" ? (
                <UserRound size={16} />
              ) : (
                <Box size={16} />
              )}
              {object.name}
            </button>
          ))
        ) : (
          <p>
            <I18nText text="Add a figure, prop, or light to begin." />
          </p>
        )}
      </section>
      <p className={cn("mt-auto text-[10px] leading-snug text-zinc-600")}>
        <I18nText text="Added objects appear in front of the camera." />
      </p>
    </aside>
  );
}
