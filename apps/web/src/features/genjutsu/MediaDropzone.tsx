import { t, useLocale } from "@dirrio/ui/i18n";
import { useRef, useState, type ReactNode } from "react";
import { ASSET_ALLOWED_MIME } from "@dirrio/shared";

/** Native file chooser and desktop file drops share the same validation/upload path. */
export function MediaDropzone({
  type,
  disabled = false,
  onFiles,
  children,
}: {
  type: "video" | "image";
  disabled?: boolean;
  onFiles: (files: File[]) => Promise<void>;
  children: ReactNode;
}) {
  useLocale();
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const depth = useRef(0);
  const label =
    type === "video" ? "Upload source video" : "Upload reference images";
  async function accept(files: File[]) {
    if (disabled || !files.length) return;
    setError(null);
    if (type === "video" && files.length !== 1) {
      setError("Choose one source video at a time.");
      return;
    }
    const valid = files.every((file) => {
      const mime = file.type.split(";")[0]!.toLowerCase();
      return mime
        ? ASSET_ALLOWED_MIME[type].includes(mime)
        : (type === "video"
            ? /\.(mp4|mov|webm|m4v)$/i
            : /\.(png|jpe?g|webp|gif)$/i
          ).test(file.name);
    });
    if (!valid) {
      setError(
        type === "video"
          ? "Drop a supported video file in the source area."
          : "Drop only supported image files in the reference area.",
      );
      return;
    }
    try {
      await onFiles(files);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed");
    }
  }
  return (
    <div className="genjutsu-dropzone">
      <label
        className={`genjutsu-upload ${type === "image" ? "genjutsu-upload-small" : ""} ${dragging && !disabled ? "genjutsu-upload-dragging" : ""}`}
        aria-disabled={disabled}
        onDragEnter={(event) => {
          if (!Array.from(event.dataTransfer.types).includes("Files")) return;
          event.preventDefault();
          depth.current++;
          if (!disabled) setDragging(true);
        }}
        onDragOver={(event) => {
          event.preventDefault();
          event.stopPropagation();
          event.dataTransfer.dropEffect = disabled ? "none" : "copy";
        }}
        onDragLeave={(event) => {
          event.preventDefault();
          depth.current = Math.max(0, depth.current - 1);
          if (!depth.current) setDragging(false);
        }}
        onDrop={(event) => {
          event.preventDefault();
          event.stopPropagation();
          depth.current = 0;
          setDragging(false);
          void accept(Array.from(event.dataTransfer.files));
        }}
      >
        {children}
        <span>
          {dragging && !disabled
            ? t("Drop to upload")
            : t("Drag & drop or click to browse")}
        </span>
        <input
          aria-label={t(label)}
          type="file"
          accept={type === "video" ? "video/*" : "image/*"}
          multiple={type === "image"}
          disabled={disabled}
          onChange={(event) => {
            void accept(Array.from(event.target.files ?? []));
            event.target.value = "";
          }}
        />
      </label>
      {error && (
        <p role="alert" className="transform-error">
          {t(error ?? "")}
        </p>
      )}
    </div>
  );
}
