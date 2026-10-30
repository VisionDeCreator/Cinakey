import { Component, useEffect, useRef, useState, type ReactNode } from "react";
import { api, type Id, type Doc } from "@dirrio/backend";
import {
  useAction,
  useMutation,
  useQuery,
  useQueryStatus,
} from "@dirrio/api-client";
import { useClient } from "@dirrio/api-client/context";
import { hasAdminPermission, helpArticleSnapshot } from "@dirrio/shared";
import { t, useLocale, languages } from "./i18n";
import {
  MessageCircle,
  BookOpen,
  Sparkles,
  Plus,
  ArrowLeft,
  Paperclip,
  Send,
  Search,
  ChevronRight,
} from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./select";
import { Button } from "./button";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "./dialog";

function useSupportPolling() {
  const client = useClient();
  useEffect(() => {
    const timer = setInterval(() => {
      if (document.visibilityState !== "visible") return;
      for (const entry of client.queries.values())
        if (entry.name.startsWith("support:") && entry.listeners.size)
          void client.load(entry, true);
    }, 2500);
    return () => clearInterval(timer);
  }, [client]);
}
function errorText(e: unknown) {
  return t(e instanceof Error ? e.message : String(e));
}
function Language({
  value,
  onChange,
  label = t("Conversation language"),
}: {
  value: string;
  onChange: (value: string) => void;
  label?: string;
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger aria-label={label}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {languages.map((l) => (
          <SelectItem key={l.code} value={l.code}>
            {l.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
function SupportWidgetContent({
  workspaceId,
}: {
  workspaceId?: Id<"workspaces">;
}) {
  useLocale();
  const [open, setOpen] = useState(false);
  const result = useQuery(api.support.conversations, {
    staff: false,
    paginationOpts: { numItems: 25, cursor: null },
  });
  const unread =
    result?.page.filter(
      (c) => (c.publicSequence ?? c.sequence) > c.customerRead,
    ).length ?? 0;
  return (
    <>
      <Button
        variant="outline"
        className="support-launcher"
        onClick={() => setOpen(true)}
        aria-label={t("Help and support")}
      >
        <MessageCircle size={20} aria-hidden="true" /> {t("Help")}{" "}
        {unread > 0 && <b>{unread}</b>}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="support-dialog">
          <div className="support-dialog-heading">
            <DialogTitle>{t("Help and support")}</DialogTitle>
            <DialogDescription>
              {t("Ask a question, browse help, or contact our team.")}
            </DialogDescription>
          </div>
          <SupportWorkspace staff={false} workspaceId={workspaceId} />
        </DialogContent>
      </Dialog>
    </>
  );
}
function SupportWorkspaceContent({
  staff,
  workspaceId,
  view,
}: {
  staff: boolean;
  view?: "chats" | "help";
  workspaceId?: Id<"workspaces">;
}) {
  const uiLanguage = useLocale();
  useSupportPolling();
  const [tab, setTab] = useState<"chats" | "help">("chats");
  const [selected, setSelected] = useState<Id<"supportConversations"> | null>(
    () =>
      staff
        ? (new URLSearchParams(window.location.search).get(
            "conversation",
          ) as Id<"supportConversations"> | null)
        : null,
  );
  const [cursor, setCursor] = useState<string | null>(null),
    [filter, setFilter] = useState("all"),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const me = useQuery(api.users.viewer, {});
  const result = useQuery(api.support.conversations, {
    staff,
    paginationOpts: { numItems: 25, cursor },
  });
  const connection = useQueryStatus(api.support.conversations, {
    staff,
    paginationOpts: { numItems: 25, cursor },
  });
  const start = useMutation(api.support.start);
  const visible = result?.page.filter(
    (c) =>
      filter === "all" ||
      (filter === "mine" && c.assignedTo === me?._id) ||
      (filter === "unassigned" && !c.assignedTo && c.status !== "resolved") ||
      c.status === filter,
  );
  return (
    <div
      className={`support-workspace ${staff ? "support-staff" : "support-customer"}`}
    >
      {!view && (
        <nav className="support-tabs" aria-label={t("Support navigation")}>
          <Button
            variant="ghost"
            aria-current={tab === "chats" ? "page" : undefined}
            onClick={() => setTab("chats")}
          >
            {t("Conversations")}
          </Button>
          <Button
            variant="ghost"
            aria-current={tab === "help" ? "page" : undefined}
            onClick={() => setTab("help")}
          >
            {t("Help articles")}
          </Button>
        </nav>
      )}
      {connection.isReconnecting && (
        <p role="status">{t("Reconnecting automatically…")}</p>
      )}
      {error && <p role="alert">{error}</p>}
      {(view ?? tab) === "help" ? (
        <HelpLibrary
          staff={staff}
          onContact={view ? undefined : () => setTab("chats")}
        />
      ) : (
        <div
          className={`support-columns ${selected ? "support-selected" : ""}`}
        >
          <aside className="support-list" aria-label={t("Conversations")}>
            {staff ? (
              <Select
                value={filter}
                onValueChange={(value) => {
                  setFilter(value);
                  setSelected(null);
                }}
              >
                <SelectTrigger
                  aria-label={t("Filter conversations on this page")}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {" "}
                  {[
                    "all",
                    "unassigned",
                    "mine",
                    "staff",
                    "customer",
                    "resolved",
                  ].map((v) => (
                    <SelectItem key={v} value={v}>
                      {t(
                        {
                          all: "All conversations",
                          unassigned: "Unassigned",
                          mine: "Assigned to me",
                          staff: "Waiting for staff",
                          customer: "Waiting for customer",
                          resolved: "Resolved",
                        }[v]!,
                      )}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <Button
                variant="outline"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  setError("");
                  try {
                    setSelected(
                      await start({
                        language: uiLanguage,
                        workspaceId,
                        requestId: crypto.randomUUID(),
                      }),
                    );
                  } catch (e) {
                    setError(errorText(e));
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                <Plus size={16} />
                {t("New conversation")}
              </Button>
            )}
            {!result && <p role="status">{t("Loading…")}</p>}
            {visible?.length === 0 && (
              <p>{t("No conversations on this page.")}</p>
            )}
            {visible?.map((c) => (
              <button
                className={`support-list-item ${c._id === selected ? "support-active" : ""}`}
                key={c._id}
                onClick={() => setSelected(c._id)}
              >
                <strong>
                  {c.subject === "New conversation"
                    ? t("New conversation")
                    : c.subject}
                </strong>
                {staff && <small>{c.customer}</small>}
                <small>
                  {t(
                    c.status === "resolved"
                      ? "Resolved"
                      : c.mode === "queued"
                        ? "Waiting for staff"
                        : c.mode === "human"
                          ? "Human support"
                          : "AI assistant",
                  )}{" "}
                  · {new Date(c.updatedAt).toLocaleDateString(uiLanguage)}
                </small>
                {(staff ? c.sequence : (c.publicSequence ?? c.sequence)) >
                  (staff ? c.staffRead : c.customerRead) && (
                  <b className="support-unread">{t("Unread")}</b>
                )}
              </button>
            ))}
            <div className="support-actions">
              <Button
                variant="ghost"
                disabled={!cursor}
                onClick={() => setCursor(null)}
              >
                {t("First page")}
              </Button>
              <Button
                variant="ghost"
                disabled={!result || result.isDone}
                onClick={() => result && setCursor(result.continueCursor)}
              >
                {t("Next page")}
              </Button>
            </div>
            {staff && (
              <small>{t("Filters apply to the displayed page.")}</small>
            )}
          </aside>
          {selected ? (
            <Conversation
              key={selected}
              id={selected}
              staff={staff}
              onBack={() => setSelected(null)}
            />
          ) : (
            <div className="support-empty">
              <span aria-hidden="true">
                <Sparkles size={30} />
              </span>
              <h3>{t(staff ? "Your support inbox" : "How can we help?")}</h3>
              <p>
                {t(
                  staff
                    ? "Choose a conversation to view its history and reply."
                    : "Start a conversation or browse the knowledge base.",
                )}
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
function Conversation({
  id,
  staff,
  onBack,
}: {
  id: Id<"supportConversations">;
  staff: boolean;
  onBack: () => void;
}) {
  const uiLanguage = useLocale();
  const [languageChoice, setLanguageChoice] = useState<{
    locale: string;
    value: string;
  } | null>(null);
  const language =
    languageChoice?.locale === uiLanguage ? languageChoice.value : uiLanguage;
  const setLanguage = (value: string) =>
    setLanguageChoice({ locale: uiLanguage, value });
  const [cursor, setCursor] = useState<string | null>(null),
    [text, setText] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [note, setNote] = useState(false);
  const [files, setFiles] = useState<
    { id: Id<"supportAttachments">; name: string }[]
  >([]);
  const [articleId, setArticleId] = useState<Id<"helpArticles"> | null>(null);
  const request = useRef<string | null>(null),
    end = useRef<HTMLDivElement>(null);
  const result = useQuery(api.support.detail, {
    conversationId: id,
    staff,
    language,
    paginationOpts: { cursor, numItems: 40 },
  });
  const me = useQuery(api.users.viewer, {}),
    canWrite = !staff || hasAdminPermission(me, "support.write");
  const send = useMutation(api.support.send),
    update = useMutation(api.support.update),
    read = useMutation(api.support.read),
    upload = useAction(api.support.upload);
  const c = result?.conversation;
  const readSequence = staff ? c?.sequence : (c?.publicSequence ?? c?.sequence);
  const lastRead = staff ? c?.staffRead : c?.customerRead;
  useEffect(() => {
    if (
      readSequence !== undefined &&
      lastRead !== undefined &&
      !cursor &&
      readSequence > lastRead
    )
      void read({ conversationId: id, staff, sequence: readSequence }).catch(
        () => {},
      );
  }, [readSequence, lastRead, id, staff, cursor, read]);
  useEffect(() => {
    const container = end.current?.parentElement;
    if (!cursor && container) container.scrollTop = container.scrollHeight;
  }, [c?.sequence, cursor]);
  async function act(
    action:
      | "handoff"
      | "claim"
      | "unassign"
      | "resolve"
      | "reopen"
      | "resume"
      | "case",
  ) {
    if (!c) return;
    setBusy(true);
    setError("");
    try {
      await update({ conversationId: id, staff, revision: c.revision, action });
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  if (articleId)
    return <ArticleReader id={articleId} close={() => setArticleId(null)} />;
  return (
    <section className="support-conversation" aria-label={t("Conversation")}>
      <header className="support-conversation-header">
        <Button variant="ghost" onClick={onBack}>
          <ArrowLeft size={16} />
          {t("Back")}
        </Button>
        <strong>
          {c?.subject === "New conversation"
            ? t("New conversation")
            : c?.subject}
        </strong>
        <Language value={language} onChange={setLanguage} />
      </header>
      {c && (
        <div className="support-controls">
          <span>
            {t(
              c.status === "resolved"
                ? "Resolved"
                : c.mode === "ai"
                  ? "AI assistant"
                  : c.mode === "queued"
                    ? "Waiting for staff"
                    : "Human support",
            )}
          </span>
          {canWrite &&
            (c.status === "resolved" ? (
              <Button
                disabled={busy}
                variant="outline"
                onClick={() => void act("reopen")}
              >
                {t("Reopen")}
              </Button>
            ) : (
              <>
                {!staff && c.mode === "ai" && (
                  <Button
                    disabled={busy}
                    variant="outline"
                    onClick={() => void act("handoff")}
                  >
                    {t("Speak to a human")}
                  </Button>
                )}
                {staff && (
                  <details className="support-manage">
                    <summary>{t("Conversation actions")}</summary>
                    <div className="support-actions">
                      <Button
                        disabled={busy}
                        variant="outline"
                        onClick={() => void act("claim")}
                      >
                        {t("Assign to me")}
                      </Button>
                      <Button
                        disabled={busy}
                        variant="ghost"
                        onClick={() => void act("unassign")}
                      >
                        {t("Unassign")}
                      </Button>
                      <Button
                        disabled={busy}
                        variant="ghost"
                        onClick={() => void act("resolve")}
                      >
                        {t("Resolve")}
                      </Button>
                      {c.mode !== "ai" && (
                        <Button
                          disabled={busy}
                          variant="ghost"
                          onClick={() => void act("resume")}
                        >
                          {t("Resume AI")}
                        </Button>
                      )}
                      <Button
                        disabled={busy || !!c.caseId}
                        variant="ghost"
                        onClick={() => void act("case")}
                      >
                        {t(c.caseId ? "Case linked" : "Create support case")}
                      </Button>
                    </div>
                  </details>
                )}
              </>
            ))}
          {staff && (
            <a href={`/support/user/${c.userId}`}>
              {t("Account support history")}
            </a>
          )}
          {c.mode === "queued" && (
            <p>
              {t(
                "Our team will reply here. You can add details and return later.",
              )}
            </p>
          )}
        </div>
      )}
      {error && <p role="alert">{error}</p>}
      <div
        className="support-messages"
        aria-live="polite"
        aria-relevant="additions text"
      >
        {cursor && (
          <Button variant="ghost" onClick={() => setCursor(null)}>
            {t("Latest messages")}
          </Button>
        )}
        {!result && <p role="status">{t("Loading…")}</p>}
        {result?.page
          .slice()
          .reverse()
          .map((m) => (
            <Message
              key={m._id}
              message={m}
              language={language}
              staff={staff}
              openArticle={setArticleId}
            />
          ))}
        {result && !result.isDone && (
          <Button
            variant="ghost"
            onClick={() => setCursor(result.continueCursor)}
          >
            {t("Older messages")}
          </Button>
        )}
        {result?.page[0]?.aiState === "pending" && c?.mode === "ai" && (
          <p role="status">{t("Preparing an answer…")}</p>
        )}
        <div ref={end} />
      </div>
      {canWrite && c?.status !== "resolved" && (
        <form
          className={`support-composer ${note ? "support-composer-note" : ""}`}
          onSubmit={async (e) => {
            e.preventDefault();
            if (busy || (!text.trim() && !files.length)) return;
            setBusy(true);
            setError("");
            request.current ??= crypto.randomUUID();
            try {
              await send({
                conversationId: id,
                staff,
                note,
                language,
                text,
                attachments: files.map((f) => f.id),
                requestId: request.current,
              });
              setText("");
              setFiles([]);
              request.current = null;
              setCursor(null);
            } catch (e) {
              setError(errorText(e));
            } finally {
              setBusy(false);
            }
          }}
        >
          {staff && (
            <label>
              <input
                type="checkbox"
                checked={note}
                disabled={busy}
                onChange={(e) => {
                  setNote(e.target.checked);
                  request.current = null;
                }}
              />{" "}
              {t("Internal note")}
            </label>
          )}
          <textarea
            aria-label={t("Your message")}
            placeholder={t("Write your message…")}
            maxLength={6000}
            value={text}
            disabled={busy}
            onChange={(e) => {
              setText(e.target.value);
              request.current = null;
            }}
          />
          {files.map((f) => (
            <div key={f.id}>
              {f.name}{" "}
              <button
                type="button"
                disabled={busy}
                aria-label={`${t("Remove attachment")}: ${f.name}`}
                onClick={() => {
                  setFiles(files.filter((a) => a.id !== f.id));
                  request.current = null;
                }}
              >
                ×
              </button>
            </div>
          ))}
          <div className="support-actions">
            <label className="support-file">
              <Paperclip size={17} />
              {t("Attach files")}
              <input
                aria-label={t("Attach files")}
                type="file"
                multiple
                accept="image/png,image/jpeg,image/webp,application/pdf"
                disabled={busy || files.length >= 3}
                onChange={async (e) => {
                  const chosen = Array.from(e.target.files ?? []);
                  e.target.value = "";
                  if (!chosen.length) return;
                  if (
                    chosen.length + files.length > 3 ||
                    chosen.some((f) => f.size > 3 * 1024 * 1024)
                  ) {
                    setError(t("Upload up to three files, 3 MB each."));
                    return;
                  }
                  setBusy(true);
                  setError("");
                  try {
                    for (const f of chosen) {
                      const data = await new Promise<string>(
                        (resolve, reject) => {
                          const reader = new FileReader();
                          reader.onload = () =>
                            resolve(String(reader.result).split(",")[1]!);
                          reader.onerror = reject;
                          reader.readAsDataURL(f);
                        },
                      );
                      const fileId = await upload({
                        conversationId: id,
                        staff,
                        name: f.name,
                        data,
                      });
                      setFiles((previous) => [
                        ...previous,
                        { id: fileId, name: f.name },
                      ]);
                      request.current = null;
                    }
                  } catch (err) {
                    setError(errorText(err));
                  } finally {
                    setBusy(false);
                  }
                }}
              />
            </label>
            <Button
              disabled={busy || (!text.trim() && !files.length)}
              type="submit"
            >
              <Send size={16} />
              {t(
                busy ? "Working…" : note ? "Add internal note" : "Send message",
              )}
            </Button>
          </div>
          <small>
            {t("PNG, JPEG, WebP or PDF. Up to three files, 3 MB each.")}
          </small>
        </form>
      )}
    </section>
  );
}
type Detail = NonNullable<
  ReturnType<typeof useQuery<typeof api.support.detail>>
>;
function Message({
  message: m,
  language,
  staff,
  openArticle,
}: {
  message: Detail["page"][number];
  language: string;
  staff: boolean;
  openArticle: (id: Id<"helpArticles">) => void;
}) {
  const translate = useMutation(api.support.requestTranslation),
    download = useAction(api.support.download);
  const [original, setOriginal] = useState(false),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const translation = m.translation;
  useEffect(() => {
    if (m.language !== language && m.text && !translation)
      void translate({ messageId: m._id, language, staff }).catch((e) =>
        setError(errorText(e)),
      );
  }, [m._id, m.language, m.text, language, staff, translation, translate]);
  return (
    <article className={`support-message support-message-${m.role}`}>
      <div className="support-message-meta">
        <strong>
          {t(
            m.role === "customer"
              ? "Customer"
              : m.role === "assistant"
                ? "AI assistant"
                : m.role === "note"
                  ? "Internal note"
                  : "Support team",
          )}
        </strong>
        <time>{new Date(m.createdAt).toLocaleString(language)}</time>
      </div>
      <p>
        {!original && translation?.state === "done" ? translation.text : m.text}
      </p>
      {translation?.state === "done" && (
        <button onClick={() => setOriginal(!original)}>
          {t(original ? "Show translation" : "Show original")}
        </button>
      )}
      {translation?.state === "pending" && <small>{t("Translating…")}</small>}
      {translation?.state === "failed" && (
        <button
          onClick={() =>
            void translate({ messageId: m._id, language, staff }).catch((e) =>
              setError(errorText(e)),
            )
          }
        >
          {t("Translation unavailable. Retry")}
        </button>
      )}
      {m.attachments.map(
        (a) =>
          a && (
            <Button
              key={a.id}
              variant="outline"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  const f = await download({ id: a.id, staff });
                  const bytes = Uint8Array.from(atob(f.data), (c) =>
                    c.charCodeAt(0),
                  );
                  const url = URL.createObjectURL(
                    new Blob([bytes], { type: f.mime }),
                  );
                  const link = document.createElement("a");
                  link.href = url;
                  link.download = f.name;
                  link.click();
                  setTimeout(() => URL.revokeObjectURL(url), 30000);
                } catch (e) {
                  setError(errorText(e));
                } finally {
                  setBusy(false);
                }
              }}
            >
              {a.name}
            </Button>
          ),
      )}
      {m.sources.length > 0 && (
        <div>
          <small>{t("Help sources")}</small>
          {m.sources.map((s) => (
            <button
              className="support-source"
              key={s.id}
              onClick={() => openArticle(s.id)}
            >
              <BookOpen size={17} />
              <span>{s.title}</span>
              <ChevronRight size={16} />
            </button>
          ))}
        </div>
      )}
      {error && <p role="alert">{error}</p>}
    </article>
  );
}
function ArticleReader({
  id,
  close,
  onContact,
}: {
  id: Id<"helpArticles">;
  close: () => void;
  onContact?: () => void;
}) {
  const article = useQuery(api.support.article, { id });
  return (
    <section className="support-article-reader" aria-label={t("Help article")}>
      <header>
        <Button variant="ghost" onClick={close}>
          <ArrowLeft size={16} />
          {t("Back")}
        </Button>
        <span>
          <BookOpen size={16} />
          {article?.category ?? t("Knowledge base")}
        </span>
      </header>
      <div className="support-article-body">
        <h2>{article?.title ?? t("Help article")}</h2>
        {article === undefined ? (
          <p role="status">{t("Loading…")}</p>
        ) : (
          <p>{article?.body ?? t("This article is no longer available.")}</p>
        )}
      </div>
      <footer>
        <Button variant="outline" onClick={close}>
          {t("Back")}
        </Button>
        {onContact && (
          <Button onClick={onContact}>{t("Contact support")}</Button>
        )}
      </footer>
    </section>
  );
}
function HelpLibrary({
  staff,
  onContact,
}: {
  staff: boolean;
  onContact?: () => void;
}) {
  const locale = useLocale(),
    me = useQuery(api.users.viewer, {}),
    canEdit = staff && hasAdminPermission(me, "knowledge.publish");
  const [cursor, setCursor] = useState<string | null>(null),
    [search, setSearch] = useState(""),
    [id, setId] = useState<Id<"helpArticles"> | null>(null),
    [draft, setDraft] = useState<Doc<"helpArticles"> | "new" | null>(null);
  const result = useQuery(api.support.articles, {
    staff,
    paginationOpts: { cursor, numItems: 25 },
  });
  const filteredArticles = result?.page.filter((a) =>
    `${a.title} ${a.category} ${a.body}`
      .toLowerCase()
      .includes(search.toLowerCase()),
  );
  if (id)
    return (
      <ArticleReader id={id} close={() => setId(null)} onContact={onContact} />
    );
  return (
    <div className="support-library">
      <div className="support-actions support-library-toolbar">
        <label className="support-search">
          <Search size={18} />
          <input
            aria-label={t("Search articles on this page")}
            placeholder={t("Search articles on this page")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
        {canEdit && (
          <Button onClick={() => setDraft("new")}>{t("New article")}</Button>
        )}
      </div>
      <p>{t("Browse help articles. Search applies to the displayed page.")}</p>
      {draft ? (
        <ArticleEditor
          key={draft === "new" ? "new" : draft._id}
          article={draft === "new" ? null : draft}
          close={() => setDraft(null)}
          language={locale}
        />
      ) : (
        <div className="support-article-grid">
          {filteredArticles?.map((a) => (
            <article key={a._id}>
              <BookOpen className="support-book-icon" size={22} />
              <small>
                {a.category} ·{" "}
                {languages.find((l) => l.code === a.language)?.name}{" "}
                {staff && `· ${t(a.published ? "Published" : "Draft")}`}
              </small>
              <h3>
                <button onClick={() => setId(a._id)}>{a.title}</button>
              </h3>
              <p>{a.body.slice(0, 140)}</p>
              {staff && <ArticleProvenance article={a} />}
              {canEdit && (
                <Button variant="outline" onClick={() => setDraft(a)}>
                  {t("Edit article")}
                </Button>
              )}
            </article>
          ))}
        </div>
      )}
      {result === undefined && <p role="status">{t("Loading…")}</p>}
      {!!result?.page.length && filteredArticles?.length === 0 && (
        <p role="status">{t("No help articles match your search.")}</p>
      )}
      {result?.page.length === 0 && (
        <p>{t("No help articles yet. You can still contact our team.")}</p>
      )}
      <div className="support-actions">
        <Button
          variant="ghost"
          disabled={!cursor}
          onClick={() => setCursor(null)}
        >
          {t("First page")}
        </Button>
        <Button
          variant="ghost"
          disabled={!result || result.isDone}
          onClick={() => result && setCursor(result.continueCursor)}
        >
          {t("Next page")}
        </Button>
      </div>
    </div>
  );
}
function ArticleProvenance({ article }: { article: Doc<"helpArticles"> }) {
  const locale = useLocale();
  if (!article.sourceKey) return <small>{t("Manually created article")}</small>;
  const edited =
    !article.sourceBaseline ||
    helpArticleSnapshot(article) !==
      helpArticleSnapshot(article.sourceBaseline);
  return (
    <div className="space-y-1 text-xs break-all">
      <strong>
        {t("Repository article")}: {article.sourceKey}:{article.sourceLanguage}
      </strong>
      <small className="block">
        {t("Imported revision")}: {article.sourceRevision} ·{" "}
        {article.sourceHash?.slice(0, 12)}
      </small>
      {article.sourceImportedAt && (
        <small className="block">
          {t("Last content deployment")}:{" "}
          {new Date(article.sourceImportedAt).toLocaleString(locale)}
        </small>
      )}
      {(edited || article.sourceOverride) && (
        <small className="block">
          {t(
            edited
              ? "Edited in Admin; deployment review required"
              : "Approved database override",
          )}
        </small>
      )}
    </div>
  );
}

function ArticleEditor({
  article,
  close,
  language: initialLanguage,
}: {
  article: Doc<"helpArticles"> | null;
  close: () => void;
  language: string;
}) {
  const [title, setTitle] = useState(article?.title ?? ""),
    [category, setCategory] = useState(article?.category ?? ""),
    [body, setBody] = useState(article?.body ?? ""),
    [language, setLanguage] = useState(article?.language ?? initialLanguage),
    [published, setPublished] = useState(article?.published ?? false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const save = useMutation(api.support.saveArticle);
  return (
    <form
      className="support-editor"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError("");
        try {
          await save({
            id: article?._id,
            revision: article?.revision ?? 0,
            title,
            category,
            language,
            body,
            published,
          });
          close();
        } catch (err) {
          setError(errorText(err));
        } finally {
          setBusy(false);
        }
      }}
    >
      {article && <ArticleProvenance article={article} />}
      <label>
        {t("Article title")}
        <input
          required
          maxLength={160}
          value={title}
          disabled={busy}
          onChange={(e) => setTitle(e.target.value)}
        />
      </label>
      <label>
        {t("Category")}
        <input
          required
          maxLength={80}
          value={category}
          disabled={busy}
          onChange={(e) => setCategory(e.target.value)}
        />
      </label>
      <Language value={language} onChange={setLanguage} label={t("Language")} />
      <label>
        {t("Article content")}
        <textarea
          required
          maxLength={30000}
          value={body}
          disabled={busy}
          onChange={(e) => setBody(e.target.value)}
        />
      </label>
      <label>
        <input
          type="checkbox"
          checked={published}
          disabled={busy}
          onChange={(e) => setPublished(e.target.checked)}
        />{" "}
        {t("Published")}
      </label>
      <small>
        {t(
          "Published articles are immediately available to customers and the AI assistant.",
        )}
      </small>
      {error && <p role="alert">{error}</p>}
      <div className="support-actions">
        <Button type="submit" disabled={busy}>
          {t("Save article")}
        </Button>
        <Button type="button" disabled={busy} variant="ghost" onClick={close}>
          {t("Cancel")}
        </Button>
      </div>
    </form>
  );
}

class SupportBoundary extends Component<
  { children: ReactNode },
  { error: string | null }
> {
  state = { error: null as string | null };
  static getDerivedStateFromError(error: unknown) {
    return { error: errorText(error) };
  }
  render() {
    return this.state.error ? (
      <div className="support-workspace">
        <p role="alert">{this.state.error}</p>
        <Button onClick={() => window.location.reload()}>{t("Reload")}</Button>
      </div>
    ) : (
      this.props.children
    );
  }
}
export function SupportWidget(props: { workspaceId?: Id<"workspaces"> }) {
  return (
    <SupportBoundary>
      <SupportWidgetContent {...props} />
    </SupportBoundary>
  );
}
export function SupportWorkspace(props: {
  staff: boolean;
  workspaceId?: Id<"workspaces">;
  view?: "chats" | "help";
}) {
  return (
    <SupportBoundary>
      <SupportWorkspaceContent {...props} />
    </SupportBoundary>
  );
}
