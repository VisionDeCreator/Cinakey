import { useEffect, useState } from "react";
import { api, type Id } from "@cinakey/backend";
import { useAction, useMutation, useQuery } from "@/lib/api/hooks";
import { useClient } from "@/lib/api/context";
import { useConfirm } from "@/components/use-confirm";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { downloadBlob } from "./export/exportTimeline";

export function StoredExports({ projectId }: { projectId: string }) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<Id<"publishedExports"> | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const rows = useQuery(
    api.publishedExports.list,
    open ? { projectId: projectId as Id<"projects"> } : "skip",
  );
  const remove = useMutation(api.publishedExports.remove);
  const confirm = useConfirm();
  const client = useClient();
  async function download(id: string) {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`${client.baseUrl}/exports/${id}/file`, {
        headers: { Authorization: `Bearer ${client.token}` },
      });
      if (!response.ok)
        throw new Error("Stored video is unavailable or access was removed.");
      downloadBlob(await response.blob(), "video.mp4");
    } catch (error) {
      setError(error instanceof Error ? error.message : "Download failed");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="border-b border-zinc-800 p-2 text-sm">
      <Button variant="outline" onClick={() => setOpen((v) => !v)}>
        Stored videos
      </Button>
      {open && (
        <div className="space-y-2 pt-2">
          <p className="text-xs text-zinc-400">
            Stored exports are fixed snapshots. Editing the timeline never
            changes an existing video or link. Export storage limit: 5 GiB per
            workspace.
          </p>
          {rows?.length === 0 && (
            <p>No stored exports yet. Use Export to publish a saved edit.</p>
          )}
          {rows?.map((row) => (
            <div key={row._id} className="flex flex-wrap items-center gap-2">
              <span>
                {row.title} · {new Date(row.createdAt).toLocaleString()} ·{" "}
                {row.state}
                {row.sizeBytes
                  ? ` · ${(row.sizeBytes / 1024 / 1024).toFixed(1)} MiB`
                  : ""}
              </span>
              {row.state === "ready" && (
                <>
                  <Button
                    variant="outline"
                    disabled={busy}
                    onClick={() => void download(row._id)}
                  >
                    Download
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => setSelected(row._id)}
                  >
                    Share
                  </Button>
                </>
              )}
              <Button
                variant="outline"
                disabled={busy || row.state === "uploading"}
                onClick={() => {
                  void confirm({
                    title: "Delete stored video?",
                    description:
                      "This deletes the stored export and disables all of its sharing links. Your timeline is kept.",
                    confirmLabel: "Delete video",
                  }).then(async (ok) => {
                    if (!ok) return;
                    setBusy(true);
                    setError("");
                    try {
                      await remove({ publicationId: row._id });
                      if (selected === row._id) setSelected(null);
                    } catch (error) {
                      setError(
                        error instanceof Error
                          ? error.message
                          : "Delete failed",
                      );
                    } finally {
                      setBusy(false);
                    }
                  });
                }}
              >
                Delete
              </Button>
            </div>
          ))}
          {selected && (
            <ShareControls key={selected} publicationId={selected} />
          )}
          {error && <p role="alert">{error}</p>}
        </div>
      )}
    </section>
  );
}
function ShareControls({
  publicationId,
}: {
  publicationId: Id<"publishedExports">;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);
  const links = useQuery(api.exportSharing.list, { publicationId });
  const create = useAction(api.exportSharing.create);
  const revoke = useMutation(api.exportSharing.revoke);
  const [password, setPassword] = useState("");
  const [allowDownload, setAllowDownload] = useState(false);
  const [days, setDays] = useState("7");
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  return (
    <div className="space-y-2 rounded border border-zinc-700 p-3">
      <p>
        Private sharing · anyone with the link and optional password can watch.
      </p>
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          setBusy(true);
          setError("");
          setCopied(false);
          void create({
            publicationId,
            allowDownload,
            password: password || undefined,
            expiresAt:
              days === "never"
                ? undefined
                : Date.now() + Number(days) * 86400_000,
          })
            .then((result) => {
              setUrl(result.url);
              setPassword("");
            })
            .catch((error) =>
              setError(
                error instanceof Error
                  ? error.message
                  : "Could not create link",
              ),
            )
            .finally(() => setBusy(false));
        }}
      >
        <label>
          Optional password
          <Input
            type="password"
            autoComplete="new-password"
            value={password}
            minLength={8}
            maxLength={128}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        <label>
          Expires
          <select
            className="ml-2 bg-zinc-900"
            value={days}
            onChange={(e) => setDays(e.target.value)}
          >
            <option value="7">7 days</option>
            <option value="30">30 days</option>
            <option value="never">Never</option>
          </select>
        </label>
        <label>
          <input
            type="checkbox"
            checked={allowDownload}
            onChange={(e) => setAllowDownload(e.target.checked)}
          />{" "}
          Allow download
        </label>
        <Button disabled={busy}>Create private link</Button>
      </form>
      {url && (
        <div>
          <Input aria-label="New private share link" readOnly value={url} />
          <Button
            variant="outline"
            onClick={() => {
              void navigator.clipboard
                .writeText(url)
                .then(() => setCopied(true))
                .catch(() =>
                  setError("Copy unavailable. Select and copy the link above."),
                );
            }}
          >
            {copied ? "Copied" : "Copy link"}
          </Button>
          <p className="text-xs text-zinc-400">
            Save this link now. Its secret is shown only when created.
          </p>
        </div>
      )}
      {links?.map((link) => (
        <div key={link._id} className="flex items-center gap-2">
          <span>
            {new Date(link.createdAt).toLocaleString()} ·{" "}
            {link.passwordProtected ? "Password" : "Link access"} ·{" "}
            {link.allowDownload ? "Watch and download" : "Watch"} ·{" "}
            {link.revokedAt !== undefined
              ? "Revoked"
              : link.expiresAt && link.expiresAt <= now
                ? "Expired"
                : "Active"}
          </span>
          {link.revokedAt === undefined && (
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => {
                setBusy(true);
                setError("");
                void revoke({ linkId: link._id })
                  .then(() => setUrl(""))
                  .catch((error) =>
                    setError(
                      error instanceof Error
                        ? error.message
                        : "Could not revoke link",
                    ),
                  )
                  .finally(() => setBusy(false));
              }}
            >
              Revoke
            </Button>
          )}
        </div>
      ))}
      <p className="text-xs text-zinc-400">
        Watch-only hides the download option; recipients can still capture or
        save delivered video. Revocation stops future requests, not bytes
        already delivered.
      </p>
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
