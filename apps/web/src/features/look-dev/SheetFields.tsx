import type { SheetDocument } from "@cinakey/shared";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

type Props = {
  sheet: SheetDocument;
  description: string;
  onDescriptionChange: (value: string) => void;
  onFieldChange: (patch: Partial<SheetDocument>) => void;
  onBlurSave: () => void;
};

function Field({
  id,
  label,
  value,
  onChange,
  onBlur,
  multiline,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  onBlur: () => void;
  multiline?: boolean;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      {multiline ? (
        <Textarea
          id={id}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onBlur={onBlur}
          rows={3}
          className="resize-y"
        />
      ) : (
        <Input
          id={id}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onBlur={onBlur}
        />
      )}
    </div>
  );
}

export function SheetFields({
  sheet,
  description,
  onDescriptionChange,
  onFieldChange,
  onBlurSave,
}: Props) {
  if (sheet.entityKind === "character" || sheet.entityKind === "creature") {
    return (
      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          id="description"
          label="Summary"
          value={description}
          onChange={onDescriptionChange}
          onBlur={onBlurSave}
          multiline
        />
        <Field
          id="look"
          label="Look"
          value={sheet.look ?? ""}
          onChange={(v) => onFieldChange({ look: v })}
          onBlur={onBlurSave}
          multiline
        />
        <Field
          id="age"
          label="Age"
          value={sheet.age ?? ""}
          onChange={(v) => onFieldChange({ age: v })}
          onBlur={onBlurSave}
        />
        <Field
          id="build"
          label="Build"
          value={sheet.build ?? ""}
          onChange={(v) => onFieldChange({ build: v })}
          onBlur={onBlurSave}
        />
        <Field
          id="wardrobe"
          label="Wardrobe"
          value={sheet.wardrobe ?? ""}
          onChange={(v) => onFieldChange({ wardrobe: v })}
          onBlur={onBlurSave}
          multiline
        />
        <Field
          id="personality"
          label="Personality"
          value={sheet.personality ?? ""}
          onChange={(v) => onFieldChange({ personality: v })}
          onBlur={onBlurSave}
          multiline
        />
        <Field
          id="voiceNotes"
          label="Voice notes"
          value={sheet.voiceNotes ?? ""}
          onChange={(v) => onFieldChange({ voiceNotes: v })}
          onBlur={onBlurSave}
          multiline
        />
      </div>
    );
  }

  if (sheet.entityKind === "style") {
    return (
      <div className="space-y-4">
        <p className="text-sm text-zinc-400">
          Style text is injected into every generation prompt in this project.
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Field
              id="artStyleBlock"
              label="ART STYLE (project)"
              value={sheet.artStyleBlock ?? ""}
              onChange={(v) => onFieldChange({ artStyleBlock: v })}
              onBlur={onBlurSave}
              multiline
            />
          </div>
          <Field
            id="palette"
            label="Palette"
            value={sheet.palette ?? ""}
            onChange={(v) => onFieldChange({ palette: v })}
            onBlur={onBlurSave}
            multiline
          />
          <Field
            id="lighting"
            label="Lighting"
            value={sheet.lighting ?? ""}
            onChange={(v) => onFieldChange({ lighting: v })}
            onBlur={onBlurSave}
            multiline
          />
          <Field
            id="lensLook"
            label="Lens look"
            value={sheet.lensLook ?? ""}
            onChange={(v) => onFieldChange({ lensLook: v })}
            onBlur={onBlurSave}
          />
          <Field
            id="filmGrain"
            label="Film grain"
            value={sheet.filmGrain ?? ""}
            onChange={(v) => onFieldChange({ filmGrain: v })}
            onBlur={onBlurSave}
          />
          <Field
            id="mood"
            label="Mood"
            value={sheet.mood ?? ""}
            onChange={(v) => onFieldChange({ mood: v })}
            onBlur={onBlurSave}
            multiline
          />
        </div>
      </div>
    );
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field
        id="description"
        label="Summary"
        value={description}
        onChange={onDescriptionChange}
        onBlur={onBlurSave}
        multiline
      />
      <Field
        id="notes"
        label="Notes"
        value={sheet.notes ?? ""}
        onChange={(v) => onFieldChange({ notes: v })}
        onBlur={onBlurSave}
        multiline
      />
    </div>
  );
}
