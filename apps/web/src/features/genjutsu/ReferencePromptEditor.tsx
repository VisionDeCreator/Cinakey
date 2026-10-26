import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { createPortal } from "react-dom";
import {
  mentionAtCaret,
  referenceAlias,
  renameReferenceMentions,
  resolveTransformPrompt,
  replacementReferenceAlias,
  scriptMentions,
  scriptMentionRanges,
  type ReferenceBinding,
} from "@cinakey/shared";
import { PlainScriptEditor } from "../studio/PlainScriptEditor";
import { MediaThumbnail, ReferenceMedia } from "../studio/ReferenceMedia";
import {
  caretPosition,
  referencePickerPosition,
} from "../studio/referenceEditing";
import { Button } from "@/components/ui/button";

type ImageAsset = { _id: string; name: string; type: string };
export type ReferencePromptHandle = { insertAsset: (assetId: string) => void };
export const ReferencePromptEditor = forwardRef<
  ReferencePromptHandle,
  {
    projectId: string;
    sourceAssetId?: string | null;
    value: string;
    onChange: (value: string) => void;
    assets: ImageAsset[];
    urls: { assetId: string; url: string | null }[];
    bindings: ReferenceBinding[];
    disabled: boolean;
    onBind: (
      alias: string,
      assetId: string,
      expectedAssetId?: string,
    ) => Promise<void>;
  }
>(function ReferencePromptEditor(
  {
    projectId,
    sourceAssetId,
    value,
    onChange,
    assets,
    urls,
    bindings,
    disabled,
    onBind,
  },
  ref,
) {
  const textarea = useRef<HTMLTextAreaElement>(null);
  const popup = useRef<HTMLDivElement>(null);
  const range = useRef({ start: value.length, end: value.length });
  const [picker, setPicker] = useState<{
    alias: string;
    replace: boolean;
    left: number;
    top: number;
  } | null>(null);
  const [search, setSearch] = useState("");
  const [active, setActive] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [rename, setRename] = useState("");
  const [undo, setUndo] = useState<{
    alias: string;
    previous: string;
    current: string;
  } | null>(null);
  const [notice, setNotice] = useState("");
  const images = assets.filter((asset) => asset.type === "image");
  const source = assets.find(
    (asset) => asset._id === sourceAssetId && asset.type === "video",
  );
  const media = source ? [...images, source] : images;
  const resolved = resolveTransformPrompt(
    value,
    bindings,
    media.map((asset) => ({ assetId: asset._id, ...asset })),
    sourceAssetId,
  );
  const mentions = scriptMentions(value);
  const urlFor = (id: string) =>
    urls.find((entry) => entry.assetId === id)?.url;
  const results = images
    .filter(
      (asset) =>
        !search ||
        /^(image|video)_\d+$/.test(search) ||
        referenceAlias(asset.name).includes(referenceAlias(search)) ||
        bindings.some(
          (binding) =>
            binding.assetId === asset._id &&
            binding.alias.includes(referenceAlias(search)),
        ),
    )
    .sort((a, b) => a.name.localeCompare(b.name) || a._id.localeCompare(b._id));
  useEffect(() => {
    const dismiss = (event: PointerEvent) => {
      const node = event.target as Node;
      if (
        node !== textarea.current &&
        !popup.current?.contains(node) &&
        !(node as Element).closest?.(".reference-hover-preview")
      )
        setPicker(null);
    };
    const resize = () => setPicker(null);
    document.addEventListener("pointerdown", dismiss);
    window.addEventListener("resize", resize);
    return () => {
      document.removeEventListener("pointerdown", dismiss);
      window.removeEventListener("resize", resize);
    };
  }, []);
  function focus(caret: number) {
    requestAnimationFrame(() => {
      textarea.current?.focus();
      textarea.current?.setSelectionRange(caret, caret);
    });
  }
  function openAt(
    node: HTMLTextAreaElement,
    text = node.value,
    caret = node.selectionStart,
  ) {
    const match = mentionAtCaret(text, caret);
    range.current = match
      ? { start: match.start, end: match.end }
      : { start: caret, end: node.selectionEnd };
    if (!match) {
      setPicker(null);
      return;
    }
    if (match.query === "video_1" && source) {
      setPicker(null);
      setNotice("@video_1 uses the selected source video.");
      return;
    }
    setPicker({
      alias: match.query,
      replace: false,
      ...caretPosition(node, caret),
    });
    setSearch(match.query);
    setActive(0);
  }
  function openAlias(alias: string, anchor?: { left: number; top: number }) {
    if (
      resolved.resolved.find((entry) => entry.alias === alias)?.type === "video"
    ) {
      setPicker(null);
      setError(null);
      setNotice(
        `@${alias} uses the selected source video. Change it in Source footage.`,
      );
      return;
    }
    const box = textarea.current?.getBoundingClientRect();
    setPicker({
      alias,
      replace: true,
      ...referencePickerPosition(
        anchor?.left ?? box?.left ?? 8,
        anchor?.top ?? box?.bottom ?? 8,
      ),
    });
    setSearch("");
    setRename(alias);
    setActive(0);
    setError(null);
  }
  async function assign(assetId: string, forceInsert = false) {
    if (disabled) return;
    const asset = images.find((image) => image._id === assetId);
    if (!asset) return;
    const replacing = picker?.replace && !forceInsert;
    const activeAlias = picker?.alias ?? "";
    let alias =
      replacing || /^(image|video)_\d+$/.test(activeAlias)
        ? activeAlias
        : (bindings.find((binding) => binding.assetId === assetId)?.alias ??
          referenceAlias(asset.name));
    if (!alias || alias.length > 80) {
      let n = 1;
      while (
        bindings.some((binding) => binding.alias === `image_${n}`) ||
        mentions.includes(`image_${n}`)
      )
        n++;
      alias = `image_${n}`;
    }
    const originalAlias = alias;
    alias = replacementReferenceAlias(alias, "image", [
      ...mentions,
      ...bindings.map((entry) => entry.alias),
    ]);
    const previous = resolved.resolved.find(
      (entry) => entry.alias === alias,
    )?.assetId;
    const insertion = { ...range.current };
    setError(null);
    try {
      let updated: string | undefined;
      let caret = insertion.start;
      if (replacing && alias !== originalAlias) {
        updated = renameReferenceMentions(value, originalAlias, alias);
        if (updated.length > 4000)
          throw new Error("The prompt can contain up to 4000 characters.");
      } else if (!replacing) {
        const prefix =
          insertion.start && !/\s/.test(value[insertion.start - 1] ?? "")
            ? " "
            : "";
        const suffix = value.slice(insertion.end);
        const replacement = `${prefix}@${alias}${suffix && /^[\s.,!?;:)\]}]/.test(suffix) ? "" : " "}`;
        updated = value.slice(0, insertion.start) + replacement + suffix;
        if (alias !== originalAlias)
          updated = renameReferenceMentions(updated, originalAlias, alias);
        if (updated.length > 4000)
          throw new Error("The prompt can contain up to 4000 characters.");
        caret += replacement.length;
      }
      await onBind(alias, assetId);
      if (updated !== undefined) {
        onChange(updated);
        focus(caret);
      }
      setUndo(
        previous && previous !== assetId
          ? { alias, previous, current: assetId }
          : null,
      );
      setNotice(`@${alias} now uses ${asset.name} everywhere in the prompt.`);
      setPicker(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not link image");
    }
  }
  useImperativeHandle(ref, () => ({
    insertAsset: (id) => {
      void assign(id, true);
    },
  }));
  function keys(event: KeyboardEvent) {
    if (event.nativeEvent.isComposing) return;
    if (event.key === "Escape") {
      setPicker(null);
      return;
    }
    if (!picker) return;
    if (["ArrowDown", "ArrowUp"].includes(event.key)) {
      event.preventDefault();
      setActive((index) => {
        const next =
          (index +
            (event.key === "ArrowDown" ? 1 : -1) +
            Math.max(1, results.length)) %
          Math.max(1, results.length);
        requestAnimationFrame(() =>
          document
            .getElementById(`transform-reference-option-${next}`)
            ?.scrollIntoView?.({ block: "nearest" }),
        );
        return next;
      });
    }
    if (["Enter", "Tab"].includes(event.key) && results[active]) {
      event.preventDefault();
      void assign(results[active]!._id);
    }
  }
  return (
    <div className="genjutsu-reference-editor">
      <span className="genjutsu-prompt-label">Describe the change</span>
      <PlainScriptEditor
        ref={textarea}
        projectId={projectId}
        label="Describe the change"
        suggestionsId="transform-reference-suggestions"
        maxLength={4000}
        placeholder="Describe your changes. Type @ to reference an uploaded image."
        value={value}
        disabled={disabled}
        readOnly={disabled}
        expanded={picker !== null}
        activeOption={
          picker && results[active]
            ? `transform-reference-option-${active}`
            : undefined
        }
        references={mentions.map((alias) => {
          const asset = media.find(
            (image) =>
              image._id ===
              resolved.resolved.find((entry) => entry.alias === alias)?.assetId,
          );
          return { alias, asset, url: asset ? urlFor(asset._id) : null };
        })}
        onChange={(text, caret) => {
          onChange(text);
          if (textarea.current) openAt(textarea.current, text, caret);
        }}
        onCaret={(node) => {
          if (picker && !picker.replace) openAt(node);
          else
            range.current = {
              start: node.selectionStart,
              end: node.selectionEnd,
            };
        }}
        onKeyDown={keys}
        onBlur={() => {}}
        onMention={openAlias}
        onDropAsset={(id) => {
          void assign(id, true);
        }}
      />
      <div className="genjutsu-prompt-reference-tools">
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={disabled}
          onClick={() => {
            const node = textarea.current;
            const position = node
              ? caretPosition(node, range.current.start)
              : referencePickerPosition(8, 8);
            setPicker({ alias: "", replace: false, ...position });
            setSearch("");
            setActive(0);
          }}
        >
          Add reference
        </Button>
        <span>{resolved.imageIds.length}/8 images linked</span>
      </div>
      <p className="transform-muted">
        Type @ or click an image to insert it. Click a linked mention to replace
        it everywhere.
      </p>
      {mentions.length > 0 && (
        <div className="genjutsu-prompt-reference-list">
          {mentions.map((alias) => {
            const asset = media.find(
              (image) =>
                image._id ===
                resolved.resolved.find((entry) => entry.alias === alias)
                  ?.assetId,
            );
            return (
              <button
                type="button"
                disabled={disabled}
                key={alias}
                onClick={() => openAlias(alias)}
                className={asset ? "" : "missing"}
              >
                {asset && (
                  <MediaThumbnail asset={asset} url={urlFor(asset._id)} />
                )}
                <span>
                  @{alias}
                  <small>{asset?.name ?? "Link missing image"}</small>
                </span>
                <span>
                  {
                    scriptMentionRanges(value).filter(
                      (mention) => mention.alias === alias,
                    ).length
                  }
                  ×
                </span>
              </button>
            );
          })}
        </div>
      )}
      {undo && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled}
          onClick={async () => {
            try {
              await onBind(undo.alias, undo.previous, undo.current);
              setUndo(null);
              setNotice("Previous reference restored everywhere.");
            } catch (e) {
              setError(
                e instanceof Error
                  ? e.message
                  : "Could not undo reference replacement",
              );
            }
          }}
        >
          Undo reference replacement
        </Button>
      )}
      {notice && (
        <p className="transform-muted" role="status">
          {notice}
        </p>
      )}
      {error && (
        <p className="transform-error" role="alert">
          {error}
        </p>
      )}
      {picker &&
        createPortal(
          <div
            ref={popup}
            className="genjutsu-reference-picker"
            style={{ position: "fixed", left: picker.left, top: picker.top }}
            role="dialog"
            aria-label="Reference picker"
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                setPicker(null);
                textarea.current?.focus();
              }
            }}
          >
            <div className="genjutsu-section-title">
              <strong>
                {picker.replace
                  ? `Replace @${picker.alias} everywhere`
                  : "Choose image reference"}
              </strong>
              <button
                type="button"
                aria-label="Close reference picker"
                onClick={() => setPicker(null)}
              >
                ×
              </button>
            </div>
            {picker.replace && (
              <p>Every @{picker.alias} will use the selected image.</p>
            )}
            <input
              aria-label="Search references"
              placeholder="Search names or @aliases…"
              value={search}
              onChange={(event) => {
                setSearch(event.target.value.replace(/^@/, ""));
                setActive(0);
              }}
              onKeyDown={keys}
              aria-controls="transform-reference-suggestions"
            />
            <div
              id="transform-reference-suggestions"
              role="listbox"
              aria-label="Image references"
            >
              {results.map((asset, index) => (
                <ReferenceMedia
                  key={asset._id}
                  asset={asset}
                  url={urlFor(asset._id)}
                >
                  <button
                    type="button"
                    role="option"
                    id={`transform-reference-option-${index}`}
                    aria-selected={index === active}
                    aria-label={`Link ${asset.name} (image)`}
                    disabled={disabled}
                    onMouseDown={(event) => event.preventDefault()}
                    onMouseEnter={() => setActive(index)}
                    onClick={() => void assign(asset._id)}
                  >
                    <MediaThumbnail asset={asset} url={urlFor(asset._id)} />
                    <span>
                      {asset.name}
                      <small>
                        @
                        {bindings.find(
                          (binding) => binding.assetId === asset._id,
                        )?.alias ?? referenceAlias(asset.name)}
                      </small>
                    </span>
                  </button>
                </ReferenceMedia>
              ))}
              {!results.length && (
                <p>No matching images. Upload images in the reference area.</p>
              )}
            </div>
            {picker.replace && (
              <div className="genjutsu-reference-rename">
                <label>
                  Reference name
                  <input
                    aria-label="Reference name"
                    value={rename}
                    onChange={(event) => setRename(event.target.value)}
                  />
                </label>
                <Button
                  type="button"
                  size="sm"
                  disabled={disabled}
                  onClick={async () => {
                    const alias = referenceAlias(rename);
                    const bound = resolved.resolved.find(
                      (entry) => entry.alias === picker.alias,
                    );
                    try {
                      if (
                        !bound ||
                        !alias ||
                        alias.length > 80 ||
                        /^video_\d+$/.test(alias)
                      )
                        throw new Error(
                          "Link the image and use a reference name of 1–80 characters.",
                        );
                      if (
                        alias !== picker.alias &&
                        (mentions.includes(alias) ||
                          bindings.some((entry) => entry.alias === alias))
                      )
                        throw new Error(
                          "That reference name is already in use.",
                        );
                      const updated = renameReferenceMentions(
                        value,
                        picker.alias,
                        alias,
                      );
                      if (updated.length > 4000)
                        throw new Error(
                          "Renaming would exceed the prompt length limit.",
                        );
                      await onBind(alias, bound.assetId);
                      onChange(updated);
                      setPicker(null);
                    } catch (e) {
                      setError(
                        e instanceof Error
                          ? e.message
                          : "Could not rename reference",
                      );
                    }
                  }}
                >
                  Rename everywhere
                </Button>
              </div>
            )}
          </div>,
          document.body,
        )}
    </div>
  );
});
