import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
const base = (import.meta.env.VITE_API_URL ?? "http://localhost:3001").replace(
  /\/$/,
  "",
);
export function ShareWatchPage() {
  const { linkId } = useParams();
  const [secret] = useState(() => window.location.hash.slice(1));
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [info, setInfo] = useState<{
    title: string;
    allowDownload: boolean;
  } | null>(null);
  const endpoint = `${base}/public/shares/${encodeURIComponent(linkId ?? "")}`;
  useEffect(() => {
    const referrer = document.createElement("meta");
    referrer.name = "referrer";
    referrer.content = "no-referrer";
    document.head.appendChild(referrer);
    return () => referrer.remove();
  }, []);
  return (
    <main className="mx-auto flex min-h-dvh max-w-4xl flex-col justify-center gap-4 p-6 text-zinc-100">
      <h1 className="text-xl font-semibold">
        {info?.title ?? "Cinakey private video"}
      </h1>
      {!info ? (
        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            setBusy(true);
            setError("");
            void (async () => {
              const response = await fetch(`${endpoint}/session`, {
                method: "POST",
                credentials: "include",
                referrerPolicy: "no-referrer",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ secret, password }),
              });
              if (!response.ok)
                throw new Error(
                  "Link or password is invalid, expired or revoked.",
                );
              setPassword("");
              const details = await fetch(`${endpoint}/info`, {
                credentials: "include",
                cache: "no-store",
                referrerPolicy: "no-referrer",
              });
              if (!details.ok)
                throw new Error(
                  "Video unavailable. Check the link or allow site cookies.",
                );
              setInfo(await details.json());
            })()
              .catch((error) =>
                setError(
                  error instanceof Error ? error.message : "Video unavailable",
                ),
              )
              .finally(() => setBusy(false));
          }}
        >
          <p>No account required. Enter the password if one was provided.</p>
          <label>
            Password (if required)
            <Input
              type="password"
              autoComplete="current-password"
              maxLength={128}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          <Button disabled={busy || !secret}>
            {busy ? "Opening…" : "Open video"}
          </Button>
          {!secret && (
            <p>Open the complete private link, including the part after #.</p>
          )}
        </form>
      ) : (
        <>
          <video
            controls
            playsInline
            crossOrigin="use-credentials"
            controlsList={info.allowDownload ? undefined : "nodownload"}
            src={`${endpoint}/media`}
            className="w-full rounded bg-black"
            onError={() => {
              setInfo(null);
              setError(
                "Playback access expired, was revoked, or the video is unavailable. Reopen the link to try again.",
              );
            }}
          />
          {info.allowDownload && (
            <a
              className="underline"
              referrerPolicy="no-referrer"
              href={`${endpoint}/media?download=1`}
            >
              Download MP4
            </a>
          )}
          <p className="text-xs text-zinc-400">
            Private viewing access lasts up to one hour. The owner can revoke
            this link.
          </p>
        </>
      )}
      {error && <p role="alert">{error}</p>}
    </main>
  );
}
