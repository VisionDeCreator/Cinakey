import { getLocale } from "@cinakey/ui/i18n";
import { I18nText, t, useLocale } from "@cinakey/ui/i18n";
import { formatUsd } from "@cinakey/ui/i18n";
import { useWorkspace } from "@/features/workspaces/workspace-context";
import { useRef, useState } from "react";
import {
  Link,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router-dom";
import {
  ArrowLeft,
  ArrowUpRight,
  Film,
  Plus,
  Upload,
  WandSparkles,
  Trash2,
  LayoutGrid,
  List,
  ArrowRight,
  Images,
  UserRound,
  Palette,
  Mountain,
} from "lucide-react";
import { api, type Doc } from "@cinakey/backend";
import { useMutation, useQuery } from "@/lib/api/hooks";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { useAssetUpload } from "@/features/assets/useAssetUpload";
import { MediaDropzone } from "./MediaDropzone";
import type { ReferencePromptHandle } from "./ReferencePromptEditor";
import { VideoTransformPanel } from "./VideoTransformPanel";
import "./genjutsu.css";

export function GenjutsuPage() {
  useLocale();
  const { workspaceId, canCreate } = useWorkspace();
  const { sessionId } = useParams();
  const sessions = useQuery(
    api.genjutsu.list,
    workspaceId ? { workspaceId } : {},
  );
  const create = useMutation(api.genjutsu.create);
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [sort, setSort] = useState("updated");
  const [view, setView] = useState<"grid" | "list">("grid");
  const search = (params.get("q") ?? "").trim().toLowerCase();
  const visible = sessions
    ?.filter((session) => session.title.toLowerCase().includes(search))
    .sort((a, b) =>
      sort === "title"
        ? a.title.localeCompare(b.title)
        : b.updatedAt - a.updatedAt,
    );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function newSession() {
    if (busy || !canCreate) return;
    setBusy(true);
    setError(null);
    try {
      const id = await create({
        ...(workspaceId ? { workspaceId } : {}),
        title: `Transformation ${(sessions?.length ?? 0) + 1}`,
      });
      void navigate(`/remix/${id}`);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Could not create a transformation",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <div
      className={cn(
        "genjutsu-page",
        !sessionId ? "genjutsu-index" : "genjutsu-editor",
      )}
    >
      {!sessionId && (
        <header className="genjutsu-heading">
          <div>
            <span className="genjutsu-eyebrow">
              <WandSparkles size={15} />{" "}
              <I18nText text="VIDEO TRANSFORMATION" />
            </span>
            <h1>
              <I18nText text="Remix" />
            </h1>
            <p>
              <I18nText text="One performance. A different world." />
            </p>
          </div>
          <Button
            disabled={busy || !canCreate}
            onClick={() => void newSession()}
          >
            <Plus size={16} />
            {busy ? t("Creating…") : t("New transformation")}
          </Button>
        </header>
      )}
      {error && (
        <p role="alert" className="transform-error">
          {t(error ?? "")}
        </p>
      )}
      {sessionId ? (
        <GenjutsuSession key={sessionId} sessionId={sessionId} />
      ) : (
        <>
          <section
            className="genjutsu-intro genjutsu-index-intro"
            aria-label={t("About video transformations")}
          >
            <div>
              <h2>
                <I18nText text="Keep the movement." />
                <br />
                <I18nText text="Reimagine the scene." />
              </h2>
              <p>
                <I18nText text="Recast a character, explore a visual style, or move the action somewhere new." />
              </p>
              <div className="genjutsu-process">
                <Film size={18} />
                <span>
                  <I18nText text="Source video" />
                </span>
                <ArrowRight size={14} />
                <Images size={18} />
                <span>
                  <I18nText text="References" />
                </span>
                <ArrowRight size={14} />
                <WandSparkles size={18} />
                <span>
                  <I18nText text="Transformation" />
                </span>
              </div>
              <div className="genjutsu-capabilities">
                <span>
                  <UserRound size={15} />
                  <I18nText text="Recast characters" />
                </span>
                <span>
                  <Palette size={15} />
                  <I18nText text="Restyle footage" />
                </span>
                <span>
                  <Mountain size={15} />
                  <I18nText text="Change environments" />
                </span>
              </div>
            </div>
            <figure className="genjutsu-example">
              <img
                src="/images/genjutsu-example.png"
                alt={t(
                  "Illustrative comparison of a woman walking through a modern corridor and a transformed sandstone city",
                )}
              />
              <figcaption>
                <span>
                  <I18nText text="Source concept" />
                </span>
                <span>
                  <I18nText text="Illustrative transformation" />
                </span>
              </figcaption>
            </figure>
          </section>
          <section aria-label={t("Transformation sessions")}>
            <div className="genjutsu-section-title">
              <h2>
                <I18nText text="Your transformations" />
              </h2>
              <div className="flex items-center gap-2">
                <Select value={sort} onValueChange={setSort}>
                  <SelectTrigger
                    aria-label={t("Sort transformations")}
                    className="w-36 rounded-xl bg-transparent"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="updated">
                      <I18nText text="Last edited" />
                    </SelectItem>
                    <SelectItem value="title">
                      <I18nText text="Name" />
                    </SelectItem>
                  </SelectContent>
                </Select>
                <div className="flex rounded-xl border border-zinc-800 p-0.5">
                  {(["grid", "list"] as const).map((mode) => (
                    <Button
                      key={mode}
                      variant="ghost"
                      size="icon"
                      aria-label={
                        mode === "grid" ? t("Grid view") : t("List view")
                      }
                      aria-pressed={view === mode}
                      onClick={() => setView(mode)}
                      className={cn(
                        "size-8 rounded-lg",
                        view === mode &&
                          "bg-[var(--color-studio-accent-soft)] text-[var(--color-studio-accent)]",
                      )}
                    >
                      {mode === "grid" ? <LayoutGrid /> : <List />}
                    </Button>
                  ))}
                </div>
              </div>
            </div>
            {sessions === undefined ? (
              <p role="status">
                <I18nText text="Loading transformations…" />
              </p>
            ) : visible?.length ? (
              <div
                className={cn(
                  "genjutsu-session-grid",
                  view === "list" && "genjutsu-list-view",
                )}
              >
                {visible.map((session) => (
                  <TransformationCard key={session._id} session={session} />
                ))}
              </div>
            ) : (
              <p className="genjutsu-empty">
                {search
                  ? t("No matching transformations.")
                  : t(
                      "Your saved transformations will appear here. Start a new transformation to begin.",
                    )}
              </p>
            )}
          </section>
        </>
      )}
    </div>
  );
}
function TransformationCard({ session }: { session: Doc<"genjutsuSessions"> }) {
  useLocale();
  const urls = useQuery(
    api.storage.listProjectAssetUrls,
    session.sourceAssetId ? { projectId: session.storageScopeId } : "skip",
  );
  const sourceUrl = urls?.find(
    (item) => item.assetId === session.sourceAssetId,
  )?.url;
  return (
    <Link to={`/remix/${session._id}`} className="genjutsu-session-card">
      <div className="genjutsu-card-art">
        {sourceUrl ? (
          <video
            src={sourceUrl}
            muted
            playsInline
            preload="metadata"
            aria-label={t("Source footage preview")}
          />
        ) : (
          <WandSparkles size={30} />
        )}
      </div>
      <div className="genjutsu-card-details">
        <div>
          <h3>{session.title}</h3>
          <p>
            <I18nText text="Edited" />{" "}
            {new Date(session.updatedAt).toLocaleDateString(getLocale())}
          </p>
        </div>
        <ArrowUpRight size={18} aria-hidden />
      </div>
    </Link>
  );
}
function GenjutsuSession({ sessionId }: { sessionId: string }) {
  useLocale();
  const session = useQuery(api.genjutsu.get, { sessionId: sessionId as never });
  if (session === undefined)
    return (
      <p role="status">
        <I18nText text="Loading transformation…" />
      </p>
    );
  if (!session)
    return (
      <div className="genjutsu-empty">
        <p>
          <I18nText text="Transformation not found." />
        </p>
        <Link to="/remix">
          <I18nText text="Back to Remix" />
        </Link>
      </div>
    );
  return <TransformationWorkspace session={session} />;
}
function TransformationWorkspace({
  session,
}: {
  session: Doc<"genjutsuSessions">;
}) {
  useLocale();
  const scopeId = session.storageScopeId;
  const assets = useQuery(api.assets.list, { projectId: scopeId });
  const urls = useQuery(api.storage.listProjectAssetUrls, {
    projectId: scopeId,
  });
  const footage = useQuery(api.workspace.videos, { projectId: scopeId });
  const update = useMutation(api.genjutsu.update);
  const removeInput = useMutation(api.genjutsu.removeInput);
  const { uploads, uploadFiles } = useAssetUpload(scopeId);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [resultId, setResultId] = useState<string | null>(null);
  const [compare, setCompare] = useState(true);
  const [preparing, setPreparing] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  const uploading = uploads.some((item) => item.status === "uploading");
  const uploadLock = useRef(false);
  const promptEditor = useRef<ReferencePromptHandle>(null);
  const sourceRef = useRef<HTMLVideoElement>(null);
  const resultRef = useRef<HTMLVideoElement>(null);
  const inputAssets = (assets ?? []).filter(
    (asset) => !session.removedInputAssetIds?.includes(asset._id),
  );
  const source = inputAssets.find(
    (asset) => asset._id === session.sourceAssetId,
  );
  const sourceUrl =
    urls?.find((item) => item.assetId === source?._id)?.url ?? null;
  const results =
    assets?.filter((asset) => asset.type === "video" && asset.jobId) ?? [];
  const result = results.find((asset) => asset._id === resultId) ?? results[0];
  const resultUrl =
    urls?.find((item) => item.assetId === result?._id)?.url ?? null;
  const running =
    footage?.jobs.some((job) =>
      ["queued", "submitted", "running"].includes(job.status),
    ) ?? false;
  async function upload(files: File[], type: "video" | "image") {
    if (uploadLock.current || preparing || removing) return;
    if (type === "video" && session.sourceAssetId) {
      setError("Remove the current source video before uploading another.");
      return;
    }
    uploadLock.current = true;
    setError(null);
    try {
      const ids = await uploadFiles(files, { type });
      if (type === "video" && ids[0])
        await update({
          sessionId: session._id,
          sourceAssetId: ids[0] as never,
        });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      uploadLock.current = false;
    }
  }
  async function removeMedia(assetId: string) {
    if (removing || uploading || preparing) return;
    setRemoving(assetId);
    setError(null);
    try {
      await removeInput({ sessionId: session._id, assetId: assetId as never });
      setNotice(
        "Input removed. Previous generations are preserved. Update any missing references in the prompt.",
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not remove input");
    } finally {
      setRemoving(null);
    }
  }
  async function playComparison() {
    setError(null);
    try {
      const videos = [sourceRef.current, resultRef.current].filter(
        (video) => video !== null,
      );
      for (const video of videos) video.currentTime = 0;
      await Promise.all(videos.map((video) => video.play()));
    } catch {
      setError("Playback could not start. Use each video's play control.");
    }
  }
  return (
    <>
      <div className="genjutsu-session-bar">
        <Link to="/remix">
          <ArrowLeft size={15} />
          <I18nText text="All transformations" />
        </Link>
        <input
          className="genjutsu-session-title"
          aria-label={t("Transformation name")}
          key={session.title}
          defaultValue={session.title}
          maxLength={120}
          onBlur={(e) => {
            if (e.target.value.trim() !== session.title)
              void update({
                sessionId: session._id,
                title: e.target.value,
              }).catch((error: Error) => setError(error.message));
          }}
        />
        <p className="genjutsu-session-subtitle">
          <I18nText text="One performance. A different world." />
        </p>
        <span className="genjutsu-engine">
          <I18nText text="Video remix" />
        </span>
      </div>
      <div className="genjutsu-workspace">
        <aside
          className="genjutsu-inputs"
          aria-label={t("Transformation inputs")}
        >
          <h2 className="genjutsu-panel-title">
            <I18nText text="Inputs" />
          </h2>
          <div className="genjutsu-section-title">
            <h2>
              <I18nText text="01 / Source footage" />
            </h2>
            <Film size={16} />
          </div>
          {session.sourceAssetId ? (
            <div className="genjutsu-selected-source">
              {sourceUrl && (
                <video
                  src={sourceUrl}
                  muted
                  playsInline
                  preload="metadata"
                  aria-label={t("Selected source video")}
                />
              )}
              <span title={source?.name}>
                {source?.name ?? t("Loading source video…")}
              </span>
              {source?.durationSec && (
                <p className="transform-muted">
                  {source.durationSec} <I18nText text="seconds" />
                  {source.width && source.height
                    ? ` · ${source.width} × ${source.height}`
                    : ""}
                </p>
              )}
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={uploading || preparing || removing !== null}
                aria-label={t("Remove source video")}
                onClick={() => void removeMedia(session.sourceAssetId!)}
              >
                <Trash2 size={14} />
                {removing === session.sourceAssetId
                  ? t("Removing…")
                  : t("Remove video")}
              </Button>
            </div>
          ) : (
            <MediaDropzone
              type="video"
              disabled={uploading || preparing || removing !== null}
              onFiles={(files) => upload(files, "video")}
            >
              <Upload size={22} />
              <strong>
                <I18nText text="Upload a source video" />
              </strong>
              <span>
                <I18nText text="4–15 seconds · up to 200 MiB" />
              </span>
            </MediaDropzone>
          )}
          <div className="genjutsu-section-title">
            <h2>
              <I18nText text="02 / Reference images" />
            </h2>
          </div>
          <MediaDropzone
            type="image"
            disabled={uploading || preparing || removing !== null}
            onFiles={(files) => upload(files, "image")}
          >
            <Plus size={20} />
            <strong>
              <I18nText text="Add image references" />
            </strong>
            <span>
              <I18nText text="Characters, style, wardrobe, or settings" />
            </span>
          </MediaDropzone>
          <div className="genjutsu-reference-grid">
            {inputAssets
              .filter((asset) => asset.type === "image")
              .map((asset) => {
                const url = urls?.find(
                  (item) => item.assetId === asset._id,
                )?.url;
                return (
                  <figure key={asset._id}>
                    <button
                      type="button"
                      disabled={uploading || preparing || removing !== null}
                      title={t("Insert reference: {0}", { 0: asset.name })}
                      aria-label={t("Insert reference {0}", { 0: asset.name })}
                      onClick={() =>
                        promptEditor.current?.insertAsset(asset._id)
                      }
                      draggable={!uploading && !preparing}
                      onDragStart={(event) => {
                        event.dataTransfer.setData(
                          "application/x-cinakey-asset",
                          JSON.stringify({ assetId: asset._id }),
                        );
                        event.dataTransfer.effectAllowed = "copy";
                      }}
                    >
                      {url ? (
                        <img src={url} alt={asset.name} />
                      ) : (
                        <span className="genjutsu-image-placeholder">
                          <I18nText text="Image preview unavailable" />
                        </span>
                      )}
                      <figcaption title={asset.name}>{asset.name}</figcaption>
                      <span className="genjutsu-insert-hint">
                        <I18nText text="Click to reference" />
                      </span>
                    </button>
                    <button
                      className="genjutsu-remove-reference"
                      type="button"
                      aria-label={t("Remove reference {0}", { 0: asset.name })}
                      title={t("Remove image reference")}
                      disabled={uploading || preparing || removing !== null}
                      onClick={() => void removeMedia(asset._id)}
                    >
                      <Trash2 size={13} />
                      <span>
                        {removing === asset._id ? t("Removing…") : t("Remove")}
                      </span>
                    </button>
                  </figure>
                );
              })}
          </div>
          {uploads
            .filter((item) => item.status !== "done")
            .map((item) => (
              <p
                key={item.id}
                role={item.status === "error" ? "alert" : "status"}
                className={
                  item.status === "error"
                    ? "transform-error"
                    : "transform-muted"
                }
              >
                {item.name} · {item.error ?? `${item.status} ${item.progress}%`}
              </p>
            ))}
        </aside>
        <section
          className="genjutsu-preview"
          aria-label={t("Transformation preview")}
        >
          <div className="genjutsu-section-title">
            <h2>
              <I18nText text="Preview" />
            </h2>
            <div className="genjutsu-preview-tabs">
              <button aria-pressed={compare} onClick={() => setCompare(true)}>
                <I18nText text="Compare" />
              </button>
              <button aria-pressed={!compare} onClick={() => setCompare(false)}>
                <I18nText text="Result" />
              </button>
            </div>
          </div>
          <div
            className={`genjutsu-viewers ${compare ? "genjutsu-viewers-compare" : ""}`}
          >
            {compare && (
              <div>
                <span className="genjutsu-viewer-label">
                  <I18nText text="SOURCE" />
                </span>
                {sourceUrl ? (
                  <video
                    key={sourceUrl}
                    ref={sourceRef}
                    src={sourceUrl}
                    controls
                    playsInline
                    preload="metadata"
                    aria-label={t("Source video preview")}
                  />
                ) : (
                  <div className="genjutsu-preview-empty">
                    <Film size={34} />
                    <h3>
                      <I18nText text="Your source goes here" />
                    </h3>
                    <p>
                      <I18nText text="Upload a video to begin." />
                    </p>
                  </div>
                )}
              </div>
            )}
            <div>
              <span className="genjutsu-viewer-label">
                <I18nText text="RESULT" />
              </span>
              {resultUrl ? (
                <video
                  key={resultUrl}
                  ref={resultRef}
                  src={resultUrl}
                  controls
                  playsInline
                  preload="metadata"
                  aria-label={t("Transformed video preview")}
                />
              ) : (
                <div className="genjutsu-preview-empty">
                  <WandSparkles size={34} />
                  <h3>
                    <I18nText text="A new version awaits" />
                  </h3>
                  <p>
                    {running
                      ? t("Your transformation is processing.")
                      : t(
                          "Write a prompt and click Generate. Video analysis happens automatically.",
                        )}
                  </p>
                </div>
              )}
            </div>
          </div>
          <div className="genjutsu-preview-actions">
            {sourceUrl && resultUrl && compare && (
              <Button variant="outline" onClick={() => void playComparison()}>
                <I18nText text="Play both from start" />
              </Button>
            )}
            {resultUrl && (
              <a href={resultUrl} target="_blank" rel="noreferrer">
                <I18nText text="Open / download result" />{" "}
                <ArrowUpRight size={14} />
              </a>
            )}
          </div>
          <section
            className="genjutsu-results"
            aria-label={t("Transformation results")}
          >
            <div className="genjutsu-section-title">
              <h2>
                <I18nText text="Versions" />
              </h2>
              <span>
                {results.length} <I18nText text="results" />
              </span>
            </div>
            {results.length ? (
              <div className="genjutsu-result-list">
                {results.map((asset, index) => (
                  <button
                    key={asset._id}
                    aria-pressed={result?._id === asset._id}
                    onClick={() => setResultId(asset._id)}
                  >
                    {urls?.find((item) => item.assetId === asset._id)?.url ? (
                      <video
                        src={
                          urls.find((item) => item.assetId === asset._id)!.url!
                        }
                        muted
                        playsInline
                        preload="metadata"
                        aria-label={t("Version {0} preview", {
                          0: results.length - index,
                        })}
                      />
                    ) : (
                      <Film size={16} />
                    )}
                    <span>
                      <I18nText text="Version" /> {results.length - index}
                      <small>{asset.name}</small>
                    </span>
                  </button>
                ))}
              </div>
            ) : (
              <p className="transform-muted">
                <I18nText text="Generated versions stay in this session." />
              </p>
            )}
            {footage?.jobs.map((job) => (
              <p
                className={
                  job.errorMessage ? "transform-error" : "transform-muted"
                }
                key={job.jobId}
              >
                {job.model === "deepseek" ? t("Analysis") : t("Render")} ·{" "}
                {t(job.status ?? "")} · {formatUsd(job.estimatedCostUsdMicros)}
                {job.errorMessage ? ` · ${job.errorMessage}` : ""}
              </p>
            ))}
          </section>
        </section>
        <aside
          className="genjutsu-controls"
          aria-label={t("Transformation controls")}
        >
          <VideoTransformPanel
            key={source?._id ?? "empty"}
            projectId={scopeId}
            assets={inputAssets}
            sourceId={source?._id ?? null}
            sourceUrl={sourceUrl}
            running={running}
            onStarted={setNotice}
            uploading={uploading || removing !== null}
            onBusyChange={setPreparing}
            assetUrls={urls ?? []}
            referenceEditorRef={promptEditor}
          />
        </aside>
      </div>
      {notice && (
        <p role="status" className="genjutsu-notice">
          {t(notice ?? "")}
        </p>
      )}
      {error && (
        <p role="alert" className="transform-error">
          {t(error ?? "")}
        </p>
      )}
    </>
  );
}
