import { I18nText, t, useLocale } from "@dirrio/ui/i18n";
import { Children, isValidElement, type ReactElement, useState } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { webCodecsSupported } from "@/features/blockout/export/videoExport";
import { cn } from "@/lib/utils";
import {
  BLOCKOUT_EASES,
  CAMERA_MOVE_PRESETS,
  LENS_CHIPS_MM,
  horizontalFovDeg,
  type BlockoutDocument,
  type BlockoutEase,
  type BlockoutObject,
  type CameraMovePresetId,
  type CameraPose,
} from "@dirrio/shared";
import type { SelKey } from "./editorModel";

type Props = {
  doc: BlockoutDocument;
  live: CameraPose;
  cameraDirty: boolean;
  selectedObject: BlockoutObject | null;
  selectedKey: SelKey | null;
  exportBurnIn: boolean;
  exportMode: "clay" | "depth";
  exportRange: "part" | "shot";
  onLiveChange: (pose: CameraPose) => void;
  onSensorChange: (sensor: number) => void;
  onTimingChange: (opts: {
    durationSec?: number;
    fps?: number;
    aspect?: string;
  }) => void;
  onPreset: (id: CameraMovePresetId) => void;
  onKeyEase: (ease: BlockoutEase) => void;
  onKeyFrame: (f: number) => void;
  onKeyFocal: (focal: number) => void;
  onDeleteKey: () => void;
  onObjectField: (patch: Partial<BlockoutObject>) => void;
  onExportBurnIn: (v: boolean) => void;
  onExportMode: (m: "clay" | "depth") => void;
  onExportRange: (r: "part" | "shot") => void;
  onExport: () => void;
  exporting: boolean;
};

function EditorSelect({
  value,
  onChange,
  children,
  className,
}: {
  value: string | number;
  onChange: (e: { target: { value: string } }) => void;
  children: React.ReactNode;
  className?: string;
}) {
  useLocale();
  return (
    <Select
      value={String(value)}
      onValueChange={(value) => onChange({ target: { value } })}
    >
      <SelectTrigger className={className}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {Children.toArray(children)
          .filter(isValidElement)
          .map((child) => {
            const option = child as ReactElement<{
              value: string | number;
              children: React.ReactNode;
            }>;
            return (
              <SelectItem
                key={String(option.props.value)}
                value={String(option.props.value)}
              >
                {option.props.children}
              </SelectItem>
            );
          })}
      </SelectContent>
    </Select>
  );
}

function Collapsed({
  title,
  children,
  defaultOpen = false,
}: {
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  useLocale();
  return (
    <details
      open={defaultOpen}
      className="border-b border-zinc-800 py-2 [&_summary]:cursor-pointer"
    >
      <summary className="text-[10px] font-medium uppercase tracking-wide text-zinc-500">
        {title}
      </summary>
      <div className="mt-2 space-y-2">{children}</div>
    </details>
  );
}

function Num({
  label,
  value,
  onChange,
  step = 0.1,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  step?: number;
}) {
  useLocale();
  return (
    <label className="flex items-center gap-1 text-[11px] text-zinc-400">
      <span className="w-6 shrink-0">{label}</span>
      <input
        type="number"
        step={step}
        value={Number.isFinite(value) ? value : 0}
        onChange={(e) => onChange(+e.target.value)}
        className="h-7 w-full border border-zinc-800 bg-zinc-950 px-1.5 text-zinc-200"
      />
    </label>
  );
}

export function EditorInspector({
  doc,
  live,
  cameraDirty,
  selectedObject,
  selectedKey,
  exportBurnIn,
  exportMode,
  exportRange,
  onLiveChange,
  onSensorChange,
  onTimingChange,
  onPreset,
  onKeyEase,
  onKeyFrame,
  onKeyFocal,
  onDeleteKey,
  onObjectField,
  onExportBurnIn,
  onExportMode,
  onExportRange,
  onExport,
  exporting,
}: Props) {
  useLocale();
  const [tab, setTab] = useState("camera");
  const canEncode = webCodecsSupported();
  const durationSec = +(doc.frames / doc.fps).toFixed(2);
  const hfov = horizontalFovDeg(doc.camera.sensor, live.focal).toFixed(1);

  const selCamKey =
    selectedKey?.kind === "cam"
      ? doc.camera.keys.find((k) => k.id === selectedKey.id)
      : null;
  const selObjKey =
    selectedKey?.kind === "obj"
      ? selectedObject?.keys.find((k) => k.f === selectedKey.f)
      : null;
  const activeKey = selCamKey ?? selObjKey;

  return (
    <aside
      aria-label={t("Staging settings")}
      className="staging-editor-inspector flex w-56 shrink-0 flex-col overflow-y-auto border-l border-zinc-800 bg-zinc-950 p-2 text-xs"
    >
      <div className="staging-inspector-tabs">
        {["camera", "object"].map((name) => (
          <button
            type="button"
            key={name}
            aria-pressed={tab === name}
            onClick={() => setTab(name)}
          >
            {name === "camera" ? t("Camera") : t("Object")}
          </button>
        ))}
      </div>
      <div hidden={tab !== "camera"}>
        <section className="space-y-2 border-b border-zinc-800 py-3">
          <h3 className="text-[10px] font-medium uppercase tracking-wide text-zinc-500">
            <I18nText text="Lens" />
          </h3>
          <div className="flex flex-wrap gap-1">
            {LENS_CHIPS_MM.map((mm) => (
              <button
                key={mm}
                type="button"
                onClick={() => onLiveChange({ ...live, focal: mm })}
                className={cn(
                  "border px-1.5 py-0.5 text-[10px]",
                  Math.round(live.focal) === mm
                    ? "staging-editor-active"
                    : "border-zinc-800 text-zinc-400 hover:border-zinc-600",
                )}
              >
                {mm}
              </button>
            ))}
          </div>
          <input
            type="range"
            min={10}
            max={200}
            value={Math.round(live.focal)}
            onChange={(e) => onLiveChange({ ...live, focal: +e.target.value })}
            className="w-full"
          />
          <p className="text-[10px] text-zinc-500">
            {Math.round(live.focal)}
            <I18nText text="mm · HFOV" /> {hfov}°
            {cameraDirty ? " " + t("· unkeyed") : ""}
          </p>
        </section>

        <section className="space-y-2 border-b border-zinc-800 py-3">
          <h3 className="text-[10px] font-medium uppercase tracking-wide text-zinc-500">
            <I18nText text="Camera moves" />
          </h3>
          <div className="flex flex-col gap-1">
            {CAMERA_MOVE_PRESETS.map(([id, label]) => (
              <Button
                key={id}
                type="button"
                size="sm"
                variant="outline"
                className="h-7 justify-start text-[11px]"
                onClick={() => onPreset(id)}
              >
                {t(label)}
              </Button>
            ))}
          </div>
        </section>

        <section className="space-y-2 border-b border-zinc-800 pb-3">
          <h3 className="text-[10px] font-medium uppercase tracking-wide text-zinc-500">
            <I18nText text="Scene settings" />
          </h3>
          <label className="flex items-center gap-2 text-[11px] text-zinc-400">
            <I18nText text="Duration" />
            <input
              aria-label={t("Scene duration")}
              type="range"
              min={4}
              max={30}
              step={0.1}
              value={durationSec}
              onChange={(e) => onTimingChange({ durationSec: +e.target.value })}
              className="h-7 w-16 border border-zinc-800 bg-zinc-950 px-1.5 text-zinc-200"
            />
            <output>{durationSec}s</output>
          </label>
          <label className="flex items-center gap-2 text-[11px] text-zinc-400">
            FPS
            <EditorSelect
              value={doc.fps}
              onChange={(e) => onTimingChange({ fps: +e.target.value })}
              className="h-7 border border-zinc-800 bg-zinc-950 px-1 text-zinc-200"
            >
              {[24, 25, 30].map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </EditorSelect>
          </label>
          <label className="flex items-center gap-2 text-[11px] text-zinc-400">
            <I18nText text="Aspect" />
            <EditorSelect
              value={doc.aspect}
              onChange={(e) => onTimingChange({ aspect: e.target.value })}
              className="h-7 border border-zinc-800 bg-zinc-950 px-1 text-zinc-200"
            >
              {["16:9", "9:16", "21:9", "4:3", "1:1"].map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </EditorSelect>
          </label>
        </section>

        <section className="space-y-2 border-b border-zinc-800 py-3">
          <h3 className="text-[10px] font-medium uppercase tracking-wide text-zinc-500">
            <I18nText text="Export" />
          </h3>
          <label className="flex items-center gap-2 text-[11px] text-zinc-400">
            <input
              type="checkbox"
              checked={exportBurnIn}
              onChange={(e) => onExportBurnIn(e.target.checked)}
            />
            <I18nText text="Burn-in" />
          </label>
          <div className="flex gap-1">
            {(["clay", "depth"] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => onExportMode(m)}
                className={cn(
                  "flex-1 border px-2 py-1 text-[10px] capitalize",
                  exportMode === m
                    ? "staging-editor-active"
                    : "border-zinc-800 text-zinc-400",
                )}
              >
                {m === "clay" ? t("Clay") : t("Depth")}
              </button>
            ))}
          </div>
          <div className="flex gap-1">
            {(["part", "shot"] as const).map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => onExportRange(r)}
                className={cn(
                  "flex-1 border px-2 py-1 text-[10px]",
                  exportRange === r
                    ? "staging-editor-active"
                    : "border-zinc-800 text-zinc-400",
                )}
              >
                {r === "part" ? t("Whole staging") : t("Current camera cut")}
              </button>
            ))}
          </div>
          <Button
            type="button"
            size="sm"
            className="w-full"
            disabled={!canEncode || exporting}
            onClick={onExport}
          >
            {exporting
              ? t("Rendering…")
              : canEncode
                ? t("Export MP4")
                : t("No WebCodecs")}
          </Button>
          {!canEncode ? (
            <p className="text-[10px] text-amber-400">
              <I18nText text="Chromium recommended for encode." />
            </p>
          ) : null}
        </section>

        <Collapsed title={t("Camera position & target")} defaultOpen>
          <div className="grid grid-cols-3 gap-1">
            {(["x", "y", "z"] as const).map((axis, i) => (
              <Num
                key={`p${axis}`}
                label={`P${axis}`}
                value={round2(live.pos[i]!)}
                onChange={(v) => {
                  const pos = [...live.pos] as [number, number, number];
                  pos[i] = v;
                  onLiveChange({ ...live, pos });
                }}
              />
            ))}
            {(["x", "y", "z"] as const).map((axis, i) => (
              <Num
                key={`t${axis}`}
                label={`T${axis}`}
                value={round2(live.target[i]!)}
                onChange={(v) => {
                  const target = [...live.target] as [number, number, number];
                  target[i] = v;
                  onLiveChange({ ...live, target });
                }}
              />
            ))}
          </div>
          <Num
            label={t("Roll")}
            value={Math.round(live.roll)}
            step={1}
            onChange={(v) => onLiveChange({ ...live, roll: v })}
          />
        </Collapsed>

        <Collapsed title={t("Sensor")}>
          <EditorSelect
            value={doc.camera.sensor}
            onChange={(e) => onSensorChange(+e.target.value)}
            className="h-7 w-full border border-zinc-800 bg-zinc-950 px-1 text-zinc-200"
          >
            {[36, 24, 44.7].map((s) => (
              <option key={s} value={s}>
                {s}
                <I18nText text="mm" />
              </option>
            ))}
          </EditorSelect>
        </Collapsed>

        <Collapsed title={t("Selected key")} defaultOpen={Boolean(activeKey)}>
          {activeKey ? (
            <div className="space-y-2">
              <Num
                label="F"
                value={activeKey.f}
                step={1}
                onChange={onKeyFrame}
              />
              <label className="flex items-center gap-2 text-[11px] text-zinc-400">
                <I18nText text="Ease" />
                <EditorSelect
                  value={activeKey.ease}
                  onChange={(e) => onKeyEase(e.target.value as BlockoutEase)}
                  className="h-7 border border-zinc-800 bg-zinc-950 px-1 text-zinc-200"
                >
                  {BLOCKOUT_EASES.map((e) => (
                    <option key={e} value={e}>
                      {e}
                    </option>
                  ))}
                </EditorSelect>
              </label>
              {selCamKey ? (
                <Num
                  label={t("mm")}
                  value={selCamKey.focal}
                  step={1}
                  onChange={onKeyFocal}
                />
              ) : null}
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="w-full text-rose-300"
                onClick={onDeleteKey}
              >
                <I18nText text="Delete key" />
              </Button>
            </div>
          ) : (
            <p className="text-[10px] text-zinc-600">
              <I18nText text="None selected" />
            </p>
          )}
        </Collapsed>
      </div>
      <div hidden={tab !== "object"}>
        <Collapsed
          title={t("Selected object")}
          defaultOpen={Boolean(selectedObject)}
        >
          {selectedObject ? (
            <div className="space-y-2">
              <input
                value={selectedObject.name}
                onChange={(e) => onObjectField({ name: e.target.value })}
                className="h-7 w-full border border-zinc-800 bg-zinc-950 px-1.5 text-zinc-200"
              />
              <p className="text-[10px] text-zinc-500">
                {t(selectedObject.type ?? "")}
                {selectedObject.keys.length
                  ? t(" · {0} keys", { 0: selectedObject.keys.length })
                  : " " + t("· static")}
              </p>
            </div>
          ) : (
            <p className="text-[10px] text-zinc-600">
              <I18nText text="None selected" />
            </p>
          )}
        </Collapsed>
      </div>
    </aside>
  );
}

function round2(v: number) {
  return Math.round(v * 100) / 100;
}
