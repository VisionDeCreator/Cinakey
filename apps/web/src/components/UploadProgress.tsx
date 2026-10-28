import { I18nText, t, useLocale } from "@cinakey/ui/i18n";
import { useSyncExternalStore } from "react";
import { uploadProgress } from "@/lib/api/uploadProgress";
import { Button } from "@/components/ui/button";

export function UploadProgress() {
  useLocale();
  const uploads = useSyncExternalStore(
    uploadProgress.subscribe,
    uploadProgress.snapshot,
  );
  if (!uploads.length) return null;
  return (
    <section
      aria-label={t("Upload progress")}
      aria-live="polite"
      className="fixed bottom-5 right-5 z-[100] max-h-80 w-80 max-w-[calc(100vw-2rem)] space-y-3 overflow-auto rounded-2xl border border-zinc-700 bg-zinc-900 p-4 shadow-2xl"
    >
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">
          <I18nText text="Uploads" />
        </h2>
        <Button size="sm" variant="ghost" onClick={uploadProgress.clear}>
          <I18nText text="Clear finished" />
        </Button>
      </div>
      {uploads.map((upload) => (
        <div key={upload.id} className="space-y-2">
          <div className="flex justify-between gap-3 text-xs">
            <span className="truncate">{upload.name}</span>
            <span>
              {upload.status === "error"
                ? t("Failed")
                : upload.status === "done"
                  ? t("100% · Complete")
                  : `${upload.progress}%`}
            </span>
          </div>
          <div
            role="progressbar"
            aria-label={upload.name}
            aria-valuenow={upload.progress}
            aria-valuemin={0}
            aria-valuemax={100}
            className="h-1.5 overflow-hidden rounded-full bg-zinc-700"
          >
            <div
              style={{ width: `${upload.progress}%` }}
              className="h-full bg-[var(--color-studio-accent)]"
            />
          </div>
          {upload.error && (
            <p className="text-xs text-red-400">{upload.error}</p>
          )}
        </div>
      ))}
    </section>
  );
}
