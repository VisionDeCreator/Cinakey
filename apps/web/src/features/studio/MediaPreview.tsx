import { useState } from "react";
import { Button } from "@/components/ui/button";

export function MediaPreview({
  url,
  name,
  type = "video",
  onDuration,
}: {
  url: string | null;
  name: string;
  type?: string;
  onDuration?: (duration: number) => void;
}) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const failed = Boolean(url && failedUrl === url);
  return (
    <div className="studio-media-preview">
      {!url || failed ? (
        <div role="status" className="studio-media-error">
          <p>
            {failed
              ? "This media could not be played."
              : "The preview is not available yet."}
          </p>
          <p className="studio-muted">
            Your footage is preserved. Retry the preview or open the source.
          </p>
          {url && (
            <div className="flex flex-wrap justify-center gap-2">
              <Button
                variant="outline"
                onClick={() => {
                  setAttempt((n) => n + 1);
                  setFailedUrl(null);
                }}
              >
                Retry preview
              </Button>
              <Button asChild variant="outline">
                <a href={url} target="_blank" rel="noreferrer">
                  Open source
                </a>
              </Button>
            </div>
          )}
        </div>
      ) : type === "image" ? (
        <img src={url} alt={name} onError={() => setFailedUrl(url)} />
      ) : type === "audio" || type === "music" ? (
        <audio
          key={`${url}-${attempt}`}
          aria-label={name}
          src={url}
          controls
          onLoadedMetadata={(event) => {
            const duration = event.currentTarget.duration;
            if (Number.isFinite(duration) && duration > 0)
              onDuration?.(duration);
          }}
          onError={() => setFailedUrl(url)}
        />
      ) : (
        <video
          key={`${url}-${attempt}`}
          aria-label={name}
          src={url}
          controls
          playsInline
          preload="metadata"
          onLoadedMetadata={(event) => {
            const duration = event.currentTarget.duration;
            if (Number.isFinite(duration) && duration > 0)
              onDuration?.(duration);
          }}
          onError={() => setFailedUrl(url)}
        />
      )}
    </div>
  );
}
