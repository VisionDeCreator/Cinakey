import {
  BLOCKOUT_LIGHT_ROLES,
  BLOCKOUT_PROP_TYPES,
  type BlockoutLightRole,
  type BlockoutNode,
  type BlockoutPropType,
} from "@cinakey/shared";
import { Plus } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { LIGHT_DEFAULTS, PROP_LABELS } from "./editorModel";

type Props = {
  characters: Array<{ id: string; name: string }>;
  nodes: BlockoutNode[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onAddMannequin: (character?: { id: string; name: string }) => void;
  onAddProp: (type: BlockoutPropType) => void;
  onAddSet: () => void;
  onAddLight: (role: BlockoutLightRole) => void;
};

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="border-b border-zinc-800 px-3 py-3">
      <p className="mb-2 text-[10px] font-medium uppercase tracking-wider text-zinc-500">{title}</p>
      {children}
    </div>
  );
}

function AddButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-1.5 px-1.5 py-1 text-left text-xs text-zinc-300 hover:bg-zinc-800 hover:text-zinc-50"
    >
      <Plus className="size-3 text-zinc-500" />
      <span className="truncate">{label}</span>
    </button>
  );
}

const KIND_ORDER: BlockoutNode["kind"][] = ["camera", "mannequin", "prop", "set", "light", "ground"];

export function EditorLibrary({
  characters,
  nodes,
  selectedId,
  onSelect,
  onAddMannequin,
  onAddProp,
  onAddSet,
  onAddLight,
}: Props) {
  const outline = [...nodes].sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind));
  return (
    <div className="flex h-full min-h-0 flex-col overflow-y-auto">
      <Section title="Characters">
        {characters.map((c) => (
          <AddButton key={c.id} label={c.name} onClick={() => onAddMannequin(c)} />
        ))}
        <AddButton label="Untagged figure" onClick={() => onAddMannequin()} />
      </Section>
      <Section title="Props">
        <div className="grid grid-cols-2">
          {BLOCKOUT_PROP_TYPES.map((t) => (
            <AddButton key={t} label={PROP_LABELS[t]} onClick={() => onAddProp(t)} />
          ))}
          <AddButton label="Wall" onClick={onAddSet} />
        </div>
      </Section>
      <Section title="Lights">
        {BLOCKOUT_LIGHT_ROLES.map((r) => (
          <AddButton key={r} label={LIGHT_DEFAULTS[r].name} onClick={() => onAddLight(r)} />
        ))}
      </Section>
      <Section title="Scene">
        <ul>
          {outline.map((n) => (
            <li key={n.id}>
              <button
                type="button"
                onClick={() => onSelect(n.id)}
                className={cn(
                  "flex w-full items-center justify-between gap-2 px-1.5 py-1 text-left text-xs text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100",
                  n.id === selectedId && "bg-zinc-800 text-zinc-50",
                )}
              >
                <span className="truncate">{n.name}</span>
                <span className="shrink-0 text-[10px] text-zinc-600">{n.kind}</span>
              </button>
            </li>
          ))}
        </ul>
      </Section>
    </div>
  );
}
