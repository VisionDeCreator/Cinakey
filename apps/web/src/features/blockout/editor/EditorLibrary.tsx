import type { BlockoutLightRole, BlockoutObjectType } from "@cinakey/shared";
import { LIGHT_ADD_ROLES, PROP_ADD_TYPES } from "./editorModel";
import { LIGHT_DEFAULTS } from "./runtime/objects";
import { cn } from "@/lib/utils";

type Entity = { id: string; name: string; kind: string };

type Props = {
  characters: Entity[];
  onAddCharacter: (entity?: Entity) => void;
  onAddProp: (type: BlockoutObjectType) => void;
  onAddLight: (role: BlockoutLightRole) => void;
};

function Chip({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="border border-zinc-800 px-2 py-1 text-left text-[11px] text-zinc-300 transition-colors hover:border-zinc-600 hover:bg-zinc-900 hover:text-zinc-100"
    >
      + {label}
    </button>
  );
}

export function EditorLibrary({
  characters,
  onAddCharacter,
  onAddProp,
  onAddLight,
}: Props) {
  return (
    <aside className="flex w-44 shrink-0 flex-col gap-3 overflow-y-auto border-r border-zinc-800 bg-zinc-950 p-2 text-xs">
      <section>
        <h3 className="mb-1.5 text-[10px] font-medium uppercase tracking-wide text-zinc-500">
          Characters
        </h3>
        <div className="flex flex-col gap-1">
          {characters.map((c) => (
            <Chip key={c.id} label={c.name} onClick={() => onAddCharacter(c)} />
          ))}
          <Chip label="Untagged figure" onClick={() => onAddCharacter()} />
        </div>
      </section>
      <section>
        <h3 className="mb-1.5 text-[10px] font-medium uppercase tracking-wide text-zinc-500">
          Props
        </h3>
        <div className="flex flex-col gap-1">
          {PROP_ADD_TYPES.map((p) => (
            <Chip
              key={p.type}
              label={p.label}
              onClick={() => onAddProp(p.type)}
            />
          ))}
        </div>
      </section>
      <section>
        <h3 className="mb-1.5 text-[10px] font-medium uppercase tracking-wide text-zinc-500">
          Lights
        </h3>
        <div className="flex flex-col gap-1">
          {LIGHT_ADD_ROLES.map((role) => (
            <Chip
              key={role}
              label={LIGHT_DEFAULTS[role].name}
              onClick={() => onAddLight(role)}
            />
          ))}
        </div>
      </section>
      <p className={cn("mt-auto text-[10px] leading-snug text-zinc-600")}>
        + places in front of the shot camera
      </p>
    </aside>
  );
}
