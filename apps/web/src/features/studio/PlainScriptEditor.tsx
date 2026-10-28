import { t, useLocale } from "@cinakey/ui/i18n";
import { scriptMentionRanges } from "@cinakey/shared";
import { forwardRef, useRef, type KeyboardEvent, type Ref } from "react";
import { ReferenceMedia, type ReferenceMediaAsset } from "./ReferenceMedia";

type MentionMedia = {
  alias: string;
  asset?: ReferenceMediaAsset;
  url?: string | null;
};
/** A native text editor with a visual mention layer; persisted content remains plain text. */
export const PlainScriptEditor = forwardRef(function PlainScriptEditor(
  {
    value,
    disabled,
    readOnly,
    projectId,
    references,
    onChange,
    onCaret,
    onKeyDown,
    onBlur,
    onMention,
    onDropAsset,
    expanded,
    activeOption,
    label = "Script",
    placeholder = "Write your script. Type @ to link an image or video reference.",
    suggestionsId = "script-reference-suggestions",
    maxLength,
  }: {
    label?: string;
    placeholder?: string;
    suggestionsId?: string;
    maxLength?: number;
    expanded: boolean;
    activeOption?: string;
    value: string;
    disabled: boolean;
    readOnly: boolean;
    projectId: string;
    references: MentionMedia[];
    onChange: (value: string, start: number) => void;
    onCaret: (node: HTMLTextAreaElement) => void;
    onKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
    onBlur: () => void;
    onMention: (alias: string, position: { left: number; top: number }) => void;
    onDropAsset: (assetId: string) => void;
  },
  forwardedRef: Ref<HTMLTextAreaElement>,
) {
  useLocale();
  const mirror = useRef<HTMLDivElement>(null);
  const chunks: { text: string; alias?: string }[] = [];
  let cursor = 0;
  for (const mention of scriptMentionRanges(value)) {
    chunks.push(
      { text: value.slice(cursor, mention.start) },
      { text: mention.text, alias: mention.alias },
    );
    cursor = mention.end;
  }
  chunks.push({ text: value.slice(cursor) });
  return (
    <div
      className="plain-script-editor"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        try {
          const item = JSON.parse(
            e.dataTransfer.getData("application/x-cinakey-asset"),
          );
          if (typeof item.assetId === "string") onDropAsset(item.assetId);
        } catch {
          /* External file drops use the upload action. */
        }
      }}
    >
      <div className="script-mention-layer" ref={mirror} aria-hidden="true">
        {chunks.map((chunk, index) => {
          if (!chunk.alias) return <span key={index}>{chunk.text}</span>;
          const match = references.find((r) => r.alias === chunk.alias);
          const mark = (
            <span
              className={`script-mention ${match?.asset ? "linked" : "missing"}`}
              onMouseDown={(e) => e.preventDefault()}
              onClick={(event) => {
                const node = event.currentTarget;
                const line =
                  Array.from(node.getClientRects()).find(
                    (rect) =>
                      event.clientY >= rect.top && event.clientY <= rect.bottom,
                  ) ?? node.getBoundingClientRect();
                onMention(chunk.alias!, {
                  left: event.clientX || line.left,
                  top: line.bottom,
                });
              }}
            >
              {chunk.text}
            </span>
          );
          return match?.asset ? (
            <ReferenceMedia key={index} asset={match.asset} url={match.url}>
              {mark}
            </ReferenceMedia>
          ) : (
            <span key={index}>{mark}</span>
          );
        })}
        <span>{"\n"}</span>
      </div>
      <textarea
        ref={forwardedRef}
        id={`script-${projectId}`}
        aria-label={t(label)}
        value={value}
        disabled={disabled}
        readOnly={readOnly}
        spellCheck={false}
        placeholder={t(placeholder)}
        maxLength={maxLength}
        onChange={(e) => onChange(e.target.value, e.target.selectionStart)}
        onSelect={(e) => onCaret(e.currentTarget)}
        onClick={(e) => onCaret(e.currentTarget)}
        onKeyUp={(e) => {
          if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key))
            onCaret(e.currentTarget);
        }}
        onKeyDown={onKeyDown}
        onBlur={onBlur}
        onScroll={(e) => {
          if (mirror.current) {
            mirror.current.scrollTop = e.currentTarget.scrollTop;
            mirror.current.scrollLeft = e.currentTarget.scrollLeft;
          }
        }}
        aria-expanded={expanded}
        aria-activedescendant={activeOption}
        aria-autocomplete="list"
        aria-controls={suggestionsId}
      />
    </div>
  );
});
