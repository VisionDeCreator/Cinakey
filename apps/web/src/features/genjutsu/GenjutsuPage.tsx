import { formatUsd } from "@cinakey/shared";
import { useWorkspace } from "@/features/workspaces/workspace-context";
import { useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeft,
  ArrowUpRight,
  Film,
  Plus,
  Upload,
  WandSparkles,
  Trash2,
} from "lucide-react";
import { api, type Doc } from "@cinakey/backend";
import { useMutation, useQuery } from "@/lib/api/hooks";
import { Button } from "@/components/ui/button";
import { useAssetUpload } from "@/features/assets/useAssetUpload";
import { MediaDropzone } from "./MediaDropzone";
import type { ReferencePromptHandle } from "./ReferencePromptEditor";
import { VideoTransformPanel } from "./VideoTransformPanel";
import "./genjutsu.css";

export function GenjutsuPage() {
  const { workspaceId, canCreate } = useWorkspace();
  const { sessionId } = useParams();
  const sessions = useQuery(
    api.genjutsu.list,
    workspaceId ? { workspaceId } : {},
  );
  const create = useMutation(api.genjutsu.create);
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function newSession() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const id = await create({
        ...(workspaceId ? { workspaceId } : {}),
        title: `Transformation ${(sessions?.length ?? 0) + 1}`,
      });
      void navigate(`/genjutsu/${id}`);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Could not create a transformation",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="genjutsu-page">
      <header className="genjutsu-heading">
        <div>
          <span className="genjutsu-eyebrow">
            <WandSparkles size={15} /> VIDEO TRANSFORMATION
          </span>
          <h1>Genjutsu</h1>
          <p>One performance. A different world.</p>
        </div>
        <Button disabled={busy || !canCreate} onClick={() => void newSession()}>
          <Plus size={16} />
          {busy ? "Creating…" : "New transformation"}
        </Button>
      </header>
      {error && (
        <p role="alert" className="transform-error">
          {error}
        </p>
      )}
      {sessionId ? (
        <GenjutsuSession key={sessionId} sessionId={sessionId} />
      ) : (
        <>
          <section className="genjutsu-intro">
            <div>
              <span className="genjutsu-eyebrow">START WITH A VIDEO</span>
              <h2>
                Keep the movement.
                <br />
                Reimagine the scene.
              </h2>
              <p>
                Recast a character, explore a visual style, or move the action
                somewhere new. Upload your footage and references, describe the
                change, and click Generate.
              </p>
              <Button
                disabled={busy || !canCreate}
                onClick={() => void newSession()}
              >
                Create a transformation <ArrowUpRight size={16} />
              </Button>
            </div>
            <div className="genjutsu-modes">
              <span>01 / Recast characters</span>
              <span>02 / Restyle footage</span>
              <span>03 / Change environments</span>
            </div>
          </section>
          <section aria-label="Transformation sessions">
            <div className="genjutsu-section-title">
              <h2>Your transformations</h2>
              <span>{sessions?.length ?? 0} sessions</span>
            </div>
            {sessions === undefined ? (
              <p role="status">Loading transformations…</p>
            ) : sessions.length ? (
              <div className="genjutsu-session-grid">
                {sessions.map((session) => (
                  <Link
                    key={session._id}
                    to={`/genjutsu/${session._id}`}
                    className="genjutsu-session-card"
                  >
                    <div className="genjutsu-card-art">
                      <WandSparkles size={30} />
                    </div>
                    <h3>{session.title}</h3>
                    <p>
                      {new Date(session.updatedAt).toLocaleDateString()}{" "}
                      <ArrowUpRight size={14} />
                    </p>
                  </Link>
                ))}
              </div>
            ) : (
              <p className="genjutsu-empty">
                Your saved transformations will appear here.
              </p>
            )}
          </section>
        </>
      )}
    </div>
  );
}
function GenjutsuSession({ sessionId }: { sessionId: string }) {
  const session = useQuery(api.genjutsu.get, { sessionId: sessionId as never });
  if (session === undefined)
    return <p role="status">Loading transformation…</p>;
  if (!session)
    return (
      <div className="genjutsu-empty">
        <p>Transformation not found.</p>
        <Link to="/genjutsu">Back to Genjutsu</Link>
      </div>
    );
  return <TransformationWorkspace session={session} />;
}
function TransformationWorkspace({
  session,
}: {
  session: Doc<"genjutsuSessions">;
}) {
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
        <Link to="/genjutsu">
          <ArrowLeft size={15} />
          All transformations
        </Link>
        <input
          aria-label="Transformation name"
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
        <span>Sume Remix Lite · DeepSeek Flash</span>
      </div>
      <div className="genjutsu-workspace">
        <aside className="genjutsu-inputs" aria-label="Transformation inputs">
          <div className="genjutsu-section-title">
            <h2>01 / Source footage</h2>
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
                  aria-label="Selected source video"
                />
              )}
              <span title={source?.name}>
                {source?.name ?? "Loading source video…"}
              </span>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={uploading || preparing || removing !== null}
                aria-label="Remove source video"
                onClick={() => void removeMedia(session.sourceAssetId!)}
              >
                <Trash2 size={14} />
                {removing === session.sourceAssetId
                  ? "Removing…"
                  : "Remove video"}
              </Button>
            </div>
          ) : (
            <MediaDropzone
              type="video"
              disabled={uploading || preparing || removing !== null}
              onFiles={(files) => upload(files, "video")}
            >
              <Upload size={22} />
              <strong>Upload a source video</strong>
              <span>4–15 seconds · up to 200 MiB</span>
            </MediaDropzone>
          )}
          <div className="genjutsu-section-title">
            <h2>02 / Reference images</h2>
          </div>
          <MediaDropzone
            type="image"
            disabled={uploading || preparing || removing !== null}
            onFiles={(files) => upload(files, "image")}
          >
            <Plus size={20} />
            <strong>Add image references</strong>
            <span>Characters, style, wardrobe, or settings</span>
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
                      title={`Insert reference: ${asset.name}`}
                      aria-label={`Insert reference ${asset.name}`}
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
                          Image preview unavailable
                        </span>
                      )}
                      <figcaption title={asset.name}>{asset.name}</figcaption>
                      <span className="genjutsu-insert-hint">
                        Click to reference
                      </span>
                    </button>
                    <button
                      className="genjutsu-remove-reference"
                      type="button"
                      aria-label={`Remove reference ${asset.name}`}
                      title="Remove image reference"
                      disabled={uploading || preparing || removing !== null}
                      onClick={() => void removeMedia(asset._id)}
                    >
                      <Trash2 size={13} />
                      <span>
                        {removing === asset._id ? "Removing…" : "Remove"}
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
          aria-label="Transformation preview"
        >
          <div className="genjutsu-section-title">
            <h2>Preview</h2>
            <div className="genjutsu-preview-tabs">
              <button aria-pressed={compare} onClick={() => setCompare(true)}>
                Compare
              </button>
              <button aria-pressed={!compare} onClick={() => setCompare(false)}>
                Result
              </button>
            </div>
          </div>
          <div
            className={`genjutsu-viewers ${compare ? "genjutsu-viewers-compare" : ""}`}
          >
            {compare && (
              <div>
                <span className="genjutsu-viewer-label">SOURCE</span>
                {sourceUrl ? (
                  <video
                    key={sourceUrl}
                    ref={sourceRef}
                    src={sourceUrl}
                    controls
                    playsInline
                    preload="metadata"
                    aria-label="Source video preview"
                  />
                ) : (
                  <div className="genjutsu-preview-empty">
                    <Film size={34} />
                    <h3>Your source goes here</h3>
                    <p>Upload a video to begin.</p>
                  </div>
                )}
              </div>
            )}
            <div>
              <span className="genjutsu-viewer-label">RESULT</span>
              {resultUrl ? (
                <video
                  key={resultUrl}
                  ref={resultRef}
                  src={resultUrl}
                  controls
                  playsInline
                  preload="metadata"
                  aria-label="Transformed video preview"
                />
              ) : (
                <div className="genjutsu-preview-empty">
                  <WandSparkles size={34} />
                  <h3>A new version awaits</h3>
                  <p>
                    {running
                      ? "Your transformation is processing."
                      : "Write a prompt and click Generate. Video analysis happens automatically."}
                  </p>
                </div>
              )}
            </div>
          </div>
          <div className="genjutsu-preview-actions">
            {sourceUrl && resultUrl && compare && (
              <Button variant="outline" onClick={() => void playComparison()}>
                Play both from start
              </Button>
            )}
            {resultUrl && (
              <a href={resultUrl} target="_blank" rel="noreferrer">
                Open / download result <ArrowUpRight size={14} />
              </a>
            )}
          </div>
          <section
            className="genjutsu-results"
            aria-label="Transformation results"
          >
            <div className="genjutsu-section-title">
              <h2>Versions</h2>
              <span>{results.length} results</span>
            </div>
            {results.length ? (
              <div className="genjutsu-result-list">
                {results.map((asset, index) => (
                  <button
                    key={asset._id}
                    aria-pressed={result?._id === asset._id}
                    onClick={() => setResultId(asset._id)}
                  >
                    <Film size={16} />
                    <span>
                      Version {results.length - index}
                      <small>{asset.name}</small>
                    </span>
                  </button>
                ))}
              </div>
            ) : (
              <p className="transform-muted">
                Generated versions stay in this session.
              </p>
            )}
            {footage?.jobs.map((job) => (
              <p
                className={
                  job.errorMessage ? "transform-error" : "transform-muted"
                }
                key={job.jobId}
              >
                {job.model === "deepseek" ? "Analysis" : "Render"} ·{" "}
                {job.status} · {formatUsd(job.estimatedCostUsdMicros)}
                {job.errorMessage ? ` · ${job.errorMessage}` : ""}
              </p>
            ))}
          </section>
        </section>
        <aside
          className="genjutsu-controls"
          aria-label="Transformation controls"
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
          {notice}
        </p>
      )}
      {error && (
        <p role="alert" className="transform-error">
          {error}
        </p>
      )}
    </>
  );
}
