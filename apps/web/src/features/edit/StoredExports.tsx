import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Share2,
  Film,
  Download,
  Link2,
  LockKeyhole,
  Copy,
  Trash2,
  Info,
} from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import "./export-sharing.css";
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
    <section className="text-sm">
      <Button variant="outline" onClick={() => setOpen((v) => !v)}>
        <Share2 size={14} /> Share & videos
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="export-sharing-dialog flex max-h-[85vh] flex-col sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-3 text-2xl">
              <Share2 size={24} />
              Share & videos
            </DialogTitle>
            <DialogDescription>
              Saved exports and their viewing links.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-5 overflow-y-auto pt-2">
            {rows === undefined && (
              <p role="status" className="text-sm text-zinc-400">
                Loading stored videos…
              </p>
            )}
            {rows?.length === 0 && (
              <div className="export-empty">
                <Film size={32} />
                <h3>No stored videos yet</h3>
                <p>
                  Use Export MP4 and select Store video for sharing. Your saved
                  videos and link controls will appear here.
                </p>
              </div>
            )}
            {rows?.map((row) => (
              <div
                key={row._id}
                className={`stored-video-card ${selected === row._id ? "selected" : ""}`}
              >
                <div className="stored-video-cover">
                  <Film size={28} />
                </div>
                <div className="stored-video-info">
                  <h3>{row.title}</h3>
                  <p>
                    {new Date(row.createdAt).toLocaleString()}
                    {row.durationSec != null
                      ? ` · ${row.durationSec.toFixed(1)}s`
                      : ""}
                    {row.sizeBytes
                      ? ` · ${(row.sizeBytes / 1024 / 1024).toFixed(1)} MiB`
                      : ""}
                  </p>
                  <span className="export-status">{row.state}</span>
                </div>
                {row.state === "ready" && (
                  <>
                    <Button
                      variant="outline"
                      disabled={busy}
                      onClick={() => void download(row._id)}
                    >
                      <Download size={15} />
                      Download
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => setSelected(row._id)}
                    >
                      <Link2 size={15} />
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
                  <Trash2 size={15} />
                  Delete
                </Button>
              </div>
            ))}
            {selected && (
              <ShareControls key={selected} publicationId={selected} />
            )}
            {error && (
              <p role="alert" className="text-sm text-red-400">
                {error}
              </p>
            )}
            <p className="export-footnote">
              <Info size={15} />
              Stored videos are snapshots. Later edits won’t change their links.
              Workspace storage limit: 5 GiB.
            </p>
          </div>
        </DialogContent>
      </Dialog>
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
    <div className="share-link-panel">
      <h3 className="flex items-center gap-2 text-base font-semibold">
        <Link2 size={18} />
        Create a viewing link
      </h3>
      <p className="text-sm text-zinc-400">
        Anyone with the link can watch. Add a password for extra protection.
      </p>
      <form
        className="share-link-form"
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
        <label className="share-field">
          Optional password
          <Input
            placeholder="At least 8 characters"
            disabled={busy}
            type="password"
            autoComplete="new-password"
            value={password}
            minLength={8}
            maxLength={128}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        <div className="share-field">
          <label id={`expires-${publicationId}`}>Expires</label>
          <Select value={days} onValueChange={setDays} disabled={busy}>
            <SelectTrigger aria-labelledby={`expires-${publicationId}`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="7">7 days</SelectItem>
              <SelectItem value="30">30 days</SelectItem>
              <SelectItem value="never">Never</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <label className="share-download-option">
          <input
            type="checkbox"
            checked={allowDownload}
            onChange={(e) => setAllowDownload(e.target.checked)}
          />{" "}
          Allow download
        </label>
        <Button className="share-create-button" disabled={busy}>
          <Link2 size={16} />
          {busy ? "Creating…" : "Create private link"}
        </Button>
      </form>
      {url && (
        <div className="share-created-link">
          <h4 className="text-sm font-medium">New link</h4>
          <div className="share-copy-row">
            <Input aria-label="New private share link" readOnly value={url} />
            <Button
              variant="outline"
              onClick={() => {
                void navigator.clipboard
                  .writeText(url)
                  .then(() => setCopied(true))
                  .catch(() =>
                    setError(
                      "Copy unavailable. Select and copy the link above.",
                    ),
                  );
              }}
            >
              <Copy size={14} />
              {copied ? "Copied" : "Copy link"}
            </Button>
          </div>
          <p className="text-xs text-zinc-400">
            Save this link now. Its secret is shown only when created.
          </p>
        </div>
      )}
      <h4 className="text-sm font-medium">Existing links</h4>
      {links === undefined && (
        <p className="text-xs text-zinc-400">Loading links…</p>
      )}
      {links?.length === 0 && (
        <p className="text-xs text-zinc-400">No viewing links yet.</p>
      )}
      {links?.map((link) => (
        <div key={link._id} className="share-existing-link">
          <LockKeyhole size={18} />
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
