# Product help and support

The signed-in web app includes a first-party Help and support panel. Admin → Support
includes a conversation inbox and knowledge base, alongside the existing account
history, internal notes and cases. This is compiled into the existing applications;
there is no external widget script or additional frontend deployment.

## Runtime and configuration

Deploy the Convex schema/functions first, then restart both API and worker and rebuild
web/admin. The HTTP operation manifest and worker service registry must ship together.
Run the existing background worker: it delivers AI answers, message translations and
abandoned-attachment cleanup through durable tasks. The panel polls active support
queries every 2.5 seconds while the document is visible. Existing global polling
continues to provide a conversation-list unread indicator while the panel is closed.

Support uses the server's configured DeepSeek credentials and deployed model by
default. Support is platform-funded and uses a separate credential accessor, so support calls
can run in a Polar sandbox deployment without consuming customer balances. Customer
generation retains its existing sandbox admission guard. It does not debit customer generation credits. Optionally set these **server
only**, in the same environment loaded by API and worker:

- `SUPPORT_AI_ENABLED=false` disables support provider calls (human messaging remains available).
- `SUPPORT_AI_API_KEY`, `SUPPORT_AI_BASE_URL`, `SUPPORT_AI_MODEL` override the default provider with an HTTPS OpenAI-compatible endpoint. Base URL is the API prefix before `/chat/completions`.
- `SUPPORT_AI_DAILY_CALL_LIMIT=500` limits combined answer, translated-search and message-translation calls per UTC day, transactionally. Zero disables calls. This is a call ceiling, not a provider invoice/dollar cap. Each call has bounded input, 1,800 output tokens and a 45-second timeout. Retries also consume calls.

Existing global/DeepSeek/model emergency pauses also stop support calls. The support
call ceiling is separate from production generation admission and financial reports.
Use a dedicated support provider key/account if supplier-side spend isolation is needed.

## Permissions and privacy

Conversation reads/writes require the customer who opened the conversation. Workspace
membership alone never grants transcript access. Staff reads require `support.read`;
replies, internal notes, assignment and case creation require `support.write`.
The Platform administrator role has `knowledge.publish`; the Support role does not.
Draft articles are staff-only. Published article updates replace their indexed chunks
atomically, so drafts and unpublished content are not used for customer answers.

Internal notes and their attachment downloads are excluded from customer access.
Message source languages are detected asynchronously when AI is available.
Original messages are preserved; translations are separate per-message/language
records, with visible processing/failure/retry states. UI and conversation display
languages can differ. Changing the conversation language changes how messages are
shown and the language recorded for newly composed messages. AI replies use the
customer's conversation language. Languages are English, French, Spanish, Korean,
Japanese and Simplified Chinese.

## AI and human ownership

A conversation has independent ownership (`ai`, `queued`, `human`) and workflow
status (`staff`, `customer`, `resolved`). Customers can always request human help.
Staff can claim/unassign, resolve/reopen, or explicitly resume AI. Common explicit
human-request phrases in all six supported languages also request handoff.

AI tasks capture a conversation revision. A transactional check prevents an answer
from being committed after a new customer message, staff reply, handoff or resolution.
Answers cite published article IDs/revisions and recheck publication revisions at
commit. Missing knowledge, exhausted support allowance or provider failure leaves a
localized fallback and queues the conversation for staff. Failed provider calls do
not create invented answers. Product account operations remain existing staff tools.

Knowledge retrieval uses indexed full-text chunks. If a non-English query produces
no matches, the worker tries an English search translation. This version does not
include semantic embeddings, website crawling or image/PDF interpretation. Uploads
are evidence for staff; the AI is told not to claim it has inspected them.

## Attachments and lifecycle

PNG, JPEG, WebP and PDF files are accepted, up to three per message and 3 MB each.
The API validates magic bytes and size before storing data. Uploads are associated
with the authenticated uploader and conversation; send binds them transactionally.
Downloads reauthorize each request and transfer bytes through the API; raw storage
URLs are not returned to the customer. Abandoned uploads are cleaned up after an
hour using a deletion claim that prevents racing message attachment. Support R2
references participate in existing media cleanup protection. Quarantined files
cannot be downloaded through support.

Customer account erasure schedules bounded transcript/translation and attachment
cleanup. Background answer/translation tasks cannot resurrect deleted messages.
Existing storage hold enforcement still applies to physical deletion.

## Cases and operational scope

Staff may link one existing-model support case to a conversation. A case tracks
follow-up; conversation status and case status remain independent. Customer-visible
ticket numbers, email replies, availability schedules, SLA automation, typing/presence,
streaming tokens, OCR, and automatic issue-tracker integrations are outside this release.
Inbox filters and article search apply to the displayed paginated page and say so.

Seed the knowledge base with reviewed, current product articles before launch.
The reviewed starter articles in `content/help` are imported by the backend release
workflow or the explicit content deployment command. Importing is separate from
application startup; manually authored articles are preserved.

## Browser acceptance

See [the browser acceptance record](evidence/support/acceptance.json) for live DeepSeek
answer/translation checks, handoff and attachment results, screenshots, and explicit
coverage limits. Behavioral checks used the built-in browser; compilation and lint
were separate static checks. No automated test suite was run.

## Repository-managed launch articles

Launch content lives in [content/help](../content/help/README.md). Use
`bun run help:deploy --environment development` for a read-only preview and add
`--apply` to import it. Select production explicitly with its production credentials
file. The production `deploy:convex` workflow now runs this import after deploying
functions; standalone content deployment is also supported without rebuilding the apps.

Repository key/language pairs provide stable identity, and repeat imports are no-ops.
Admin-created articles remain independent. Admin edits to imported articles trigger
conflict review, with explicit repository or database resolution for each affected
article. Content and search chunks change atomically. Article origin, imported release
and local override state are visible in the Admin knowledge base. See the content
folder README for limits, retirement, container commands and conflict resolution.
