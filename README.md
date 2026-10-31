# Dirrio

Browser-based AI video production: script → image references → 3D staging →
video generation → edit → export.

Upload images or reuse existing assets as references. Dirrio does not generate
images or provide a conversational copilot. Projects open in a unified blue-and-charcoal workspace with a connected viewer,
plain-text script, references, generation history and editing timeline. Staging is
available inside the viewer; detailed reference tools remain accessible.

Type `@` in the script to link an image or video by name. Numbered aliases
such as `@image_1` and `@video_1` bind once per project, so all occurrences use
the same media ID even after the asset is renamed. Unresolved or ambiguous
references block generation before funds are reserved. The current video
provider accepts one video reference per run. Existing generated footage keeps
its input snapshot and is never replaced when a reference changes.

Preview generations independently of the edit, mark a source range, and use
**Add to timeline** to insert it. Drag library media or a generation onto a timeline
lane, or drop local files onto a lane to upload and insert them. Insertions split
footage at the drop point and shift later clips on the destination lane; other
lanes keep their timing. One undo restores the previous edit. Script planning,
staging, generation and assembly use project documents, assets and timeline clips;
they do not create scenes, sequences, shots or takes. Generation duration is an
explicit setting. Select videos in the desired order and use **Add selected videos**
for assembly; use **Replace clip source** to swap footage.

Existing projects now use the document model. Media, generation history, script
and staging history, and saved edits are preserved. Obsolete production records,
endpoints and schema tables have been removed. Saved timeline clips reference
assets directly. See [Workspace model](docs/workspace-model.md).

Resize the library, inspector and timeline using their dividers (arrow keys also
work; double-click resets the size). Panel buttons collapse the library,
inspector, generations and timeline, and the layout is remembered in this browser.
The ruler, **Fit timeline** and **Show playhead** help locate footage. Preview
messages distinguish loading, an empty edit, gaps and unavailable source media.

All project videos, including older footage
without a script association, remain visible. Audio tracks can be muted, source
audio detached, and music imported separately; separating music from effects
baked into one soundtrack is not supported.

Create a standalone project or a **Series** with multiple episodes. Series share
versioned media, characters, locations, props and style through one library;
episodes keep independent scripts, generation jobs and edits. Adopt resource
versions explicitly without duplicating the stored files. See [Series structure](docs/series.md).

TypeScript monorepo using Bun workspaces and Turborepo. The React/Vite creator
app talks to a Bun/Elysia API. A separate Bun worker handles generation and
background work. Convex provides authentication, database transactions, media metadata and JSON
file storage. Cloudflare R2 stores images, videos and audio. See [R2 setup](docs/r2-storage.md). Rendering and MP4 encoding remain in the browser.

## Setup

Requires Bun 1.3.14+, a Convex account, and optionally Google OAuth/provider keys.

```sh
bun install --frozen-lockfile
cp .env.example .env
cp apps/web/.env.example apps/web/.env.local
cp apps/admin/.env.example apps/admin/.env.local
cp packages/backend/.env.example packages/backend/.env.local
bun run dev:convex
```

Preserve existing environment files if already configured. Set the printed
Convex URL in root `.env` (`CONVEX_URL`) and both frontend environments
(`VITE_CONVEX_URL`). Set a server-only `CONVEX_DEPLOY_KEY` in root `.env`.
The web app also needs `VITE_API_URL=http://localhost:3001`.

Convex Auth continues to use its existing deployment secrets:

```sh
cd packages/backend
bunx convex env set SITE_URL http://localhost:5173
bunx convex env set JWT_PRIVATE_KEY -- '<PKCS8 key>'
bunx convex env set JWKS -- '<JWKS JSON>'
# Optional Google OAuth:
bunx convex env set AUTH_GOOGLE_ID '<client id>'
bunx convex env set AUTH_GOOGLE_SECRET '<client secret>'
```

Email login and signup use single-use codes sent by Nodemailer from the API.
Passwords are no longer supported. Existing accounts retain their workspace and billing
identity. See [email OTP configuration and cutover](docs/email-otp-auth.md).

Google's callback remains
`https://<deployment>.convex.site/api/auth/callback/google`.
Provider keys are loaded exclusively from the ignored root `.env`; missing live
keys fail validation instead of silently producing mock responses.
Provider, email and generation-webhook secrets belong to the API/worker root
`.env`, not Convex or the browser. Runtime generation uses live providers;
automated tests supply their own isolated provider fixtures. Set Convex's
`STAGING_LLM_ENABLED=false` when no DeepSeek key is configured.

From the root:

```sh
bun run dev
```

Or run `dev:api`, `dev:worker`, `dev:web`, `dev:admin` and `dev:convex` separately. The web app
opens at localhost:5173 and the API at localhost:3001 (`GET /health`).

## Admin app

Copy `apps/admin/.env.example` to `apps/admin/.env.local` and set the same public
`VITE_CONVEX_URL` and `VITE_API_URL` as the web app. Run `bun run dev:admin` to open
localhost:5174. Set `VITE_WEB_URL` to the customer app URL and `VITE_APP_ENV` to an
explicit environment label. Add the admin origin to the API's `WEB_ORIGINS` list
alongside the web origin; preserve any other configured origins. The local
fallback and root example include both ports. Do not put server keys in either
frontend's environment.

Sign in with the existing email-code flow. The server-controlled `users.isStaff`
flag is required for every Staff API operation; workspace admin roles and internal
company membership do not grant access. There is no self-service privilege grant
in the admin app. To bootstrap the first administrator, sign in to the web app
once with the intended email so that the verified account exists, then run from
the repository root:

```sh
bun run admin:promote you@example.com --reason "Initial platform administrator"
```

The script reads the root `.env` using the same loader as the API and requires
`CONVEX_URL` and `CONVEX_DEPLOY_KEY` for the intended deployment. It prints that
deployment's URL and calls an internal mutation that is unavailable through the
public API or ordinary user sessions. Run `bun run dev:convex` to deploy the new
backend function to your development deployment before first use.
Only the matching existing verified account's `isStaff` flag changes; missing,
unverified, anonymous, or ambiguous accounts are rejected. Promotions record an
audit event attributed to a deployment operator. Rerunning for an existing admin
is a no-op; trusted operators can also use this command to grant later admins.
Sign in to the admin app with that email, or reload if already signed in.

The first stage includes paginated user/workspace directories, account and
workspace details, internal company workspace creation/activation, usage funding,
moderation, provider health, egress, and audit history. Funding adjustments are
usage ledger credits, not Polar payment refunds. Customer membership and normal
production permissions are unchanged by diagnostic access. Broader financial
reconciliation, pricing publication, impersonation and granular admin roles are
outside this stage.

Staff tools now live in `apps/admin`; `/staff/*` in the web app links to their
replacement. Configure `VITE_ADMIN_URL` in the web app for the deployed admin URL.
Deploy `apps/admin/dist` as a separate static SPA with all client routes falling
back to `index.html` (a Vercel rewrite is included). Deploy the updated backend
queries and API manifest together before enabling the new frontend. Authentication
uses the existing Convex deployment; data reads/writes use the same Bun API as the
web app. Each frontend origin has its own browser session.

## Layout

```text
apps/web/                 React + Vite creator app
apps/admin/               React + Vite platform administration
apps/api/                 Elysia API, domain services and model providers
apps/worker/              Bun background process
packages/backend/         Convex Auth, schema and transactional persistence
packages/shared/          Domain types, schemas, prompts, 3D/timeline algorithms
packages/config/          Shared TypeScript, ESLint and formatting configuration
packages/ui/              Shared UI primitives, design tokens and base styles
packages/api-client/      Shared authenticated HTTP client, React hooks and OTP helpers
```

## Checks

```sh
bun run typecheck
bun run lint
bun run test
bun run build
bun run format:check
```

## Deployment

Run the API and worker as supervised Bun processes, alongside a static web host
and the existing Convex deployment. Configure `WEB_ORIGINS` explicitly, point
generation webhooks to the API's `/webhooks/generation`, and configure the web
build with `VITE_API_URL` and `VITE_CONVEX_URL`. Keep auth routes on Convex.

See [migration and deployment operations](docs/backend-migration.md) for the
cutover sequence, restart behavior, rollback, environment ownership and cost
measurement. The migration preserves existing data and IDs. File storage remains
on Convex, including its storage and download costs.

Staff accounts use `users.isStaff=true`. Administration is served separately by
`apps/admin` (locally at `http://localhost:5174`). Account lookup and manual USD
funding live under Users.
The web app has no `/dev` routes. New workspaces start with no automatic funding;
manual grants require an administrator and an audited reason. Existing balances
and payment-funded credits are preserved. Saved edits protect their source media.
Settings controls email preferences.

See [production safety and workflow](docs/production-safety.md) and the
[video provider contract](docs/provider-contract.md) for save recovery, media
retention, spending limits, supported provider operations and validation.

## Saved video generation settings

The editor's Generation panel saves resolution, duration, aspect ratio, and staging
reference selection per project. Projects without saved preferences use 720p,
5 seconds, and their existing aspect ratio (16:9 if unsupported). Changes autosave;
failed writes remain visible with a retry action and block generation until saved.
Generation aspect ratio is independent of the edit canvas. Existing timelines,
exports, and already submitted jobs keep their original settings.

Deploy the Convex schema/functions and updated API manifest before the updated web
app. The new preferences field is optional; existing projects need no bulk backfill.

## Workspace teams

Settings → Workspace team supports verified-email invitations, member roles, removal,
and Creator project/series assignments. Invitations appear in the recipient's Settings
after they sign in with the verified invited email; this release does not send email.
Owners and Admins manage access, assigned Creators collaborate on production documents,
and Reviewers cannot open production files. Shared projects and episodes appear in
Projects. Removing a member revokes subsequent production requests and clears assignments.

In the editor, Project settings → Project access only controls direct grants for
existing Creator members. Owners/Admins have automatic access; inherited series
access is shown separately and survives removal of a direct grant. Workspace-wide
membership, role, invitation and ownership controls stay on the dedicated workspace
management page linked from the panel.

Polar integration is disabled by default; team changes do not automatically purchase seats.
Payment-bound workspaces require available paid capacity for new Admin/Creator memberships.
The header workspace switcher scopes production lists, new projects/templates, series,
assets, transformations, and administrative balance/history views. Selection is stored
per account; opening a production link uses that production’s workspace. Workspace
switches close open productions after confirmation, and draft recovery is scoped by
account, workspace, and project. Owners can transfer ownership to a verified active
Admin or Creator in Settings; the previous owner remains an Admin.

Multiplayer timeline editing and external review links are still pending. See the
[Phase 1 implementation progress](docs/phase-1-implementation-plan.md#product-implementation-progress).

## Genjutsu

Open **Genjutsu** in the main sidebar to work with video transformations in a
standalone section. Create a transformation session, upload source footage and
image references, then use its dedicated source, comparison, version-history and
transformation-control layout. Sessions do not require a project or series, do
not appear in Projects, and cannot become series episodes. Their uploaded media
stays separate from the general project asset library. The project inspector no
longer contains transformation controls.

Recast a character, restyle footage, or change its environment using Sume Remix Lite. The prompt determines what changes by default. Optional checkboxes can combine
characters, visual style, environment, clothing, objects/products, and lighting
in one request. Select one to eight image references in their desired reference order. Type `@` in **Describe the change** to open the image picker,
or click/drag a library thumbnail into the prompt. The prompt uses the same
plain-text mention editor and alias resolver as project scripts: searchable
keyboard selection, previews, replacing all occurrences, renaming everywhere, and
undoing reference replacements. Referenced images are passed to both analysis and
rendering in first-mention order; missing or ambiguous references block spending.
Prompt drafts recover in the current browser. `@video_1` automatically refers to
the selected source video. When converting a mismatched numbered video alias to
an image, the editor chooses an unused `@image_N` alias and rewrites all mentions
without overwriting existing image aliases.

Click **Generate** after uploading a video and writing a prompt. Dirrio decodes
eight timestamped frames locally, analyzes them and the selected reference images
with `deepseek-flash`, then submits the transformation to Sume Remix Lite automatically.
The button shows the combined maximum estimate for analysis and rendering. Analysis
settles to reported token usage and failed analysis is refunded; rendering does
not start if analysis fails. Completed analysis is reused on render retries, which
also retain their submission request ID. Analysis and generation details remain
available in an optional disclosure. Explicit mock mode uses marked placeholder
observations without a DeepSeek request or analysis charge.

The selected source video replaces its upload area with a preview and **Remove
video** control. Remove it before uploading another source. Each reference image
also has a **Remove** control. Removal hides the input from the active session and
blocks its use in new generations while preserving existing generation files and
history. Mentions of removed images stay visible as missing until relinked.

Both source and reference upload areas accept desktop drag-and-drop as well as
file selection. The source area accepts one video per drop; references accept
multiple images. Invalid media and multi-video drops show an error. Inputs are
locked during uploads and generation preparation to avoid changing a running
request.

The first version processes whole source videos with saved duration metadata,
4–15 seconds long. It rounds source duration up for billing and requests 720p or
1080p, preserving the original source duration and aspect ratio. Camera and motion preservation are prompt
instructions, not tracked masks or guarantees. Precise isolated object replacement
and automatic shot-boundary detection are not implemented. Fast actions between
sampled frames may be missed.

Sessions live in `genjutsuSessions`. An isolated infrastructure scope marked
`purpose: genjutsu` reuses existing asset storage, generation workers and USD
accounting; these scopes are excluded from production-project listings and routes.
Generation notifications link back to the session. Rendering retries reuse the
request ID. Outputs retain source lineage; input snapshots include the versioned
plan, analysis model, sample times and selected references. Original footage stays
intact. Compare versions and open/download the selected result within Genjutsu.

### Development budget controls

Settings includes Owner/Admin budget controls for the selected workspace's UTC calendar
month and lifetime series/project/episode caps. Blank removes a cap; zero blocks new
paid jobs. Video and analysis reservations check all applicable caps atomically.
Spending reports distinguish settled usage from outstanding reservations. Series and
month attribution are pinned when reserving, including jobs completed after an episode
moves or a month ends. Assigned Creators can see project usage in Studio; workspace
financial reports and budget changes require Owner/Admin access.

Accounting now uses integer micro-USD, versioned video quotes and indexed account/scope
totals. The development rate card is provisional; real provider calls require the explicit
`ALLOW_DEVELOPMENT_PRICES=true` opt-in. Payment funding, recurring allowances and final
retail rates remain deferred. See [USD accounting](docs/usd-accounting.md) for invariants,
quote behavior, development funding and reconciliation. No credit conversion, legacy
billing bridge or payment integration was added.

### Team collaboration, stored video and sharing

See [implementation status and deployment requirements](docs/collaboration-sharing-implementation.md)
and the [permission audit](docs/collaboration-permissions-audit.md).

In the editor, Export can store a saved edit after downloading a local MP4. Stored videos
provides download/delete and private-link controls. Links support optional passwords,
expiry, watch/download permissions and revocation; recipients do not need an account.
Default limits are 200 MiB per stored video and 5 GiB of exports per workspace.

Workspace email now uses Nodemailer SMTP. Configure the `EMAIL_NOTIFICATIONS_ENABLED`
and `SMTP_*` variables in the ignored root `.env` (see `.env.example`). The API and worker
load that file; no SMTP credentials should be added to frontend environment files.
Use implicit TLS with `SMTP_SECURE=true` (normally port 465), or required STARTTLS with
`SMTP_SECURE=false` (normally port 587). Tests mock SMTP and never send live emails.

## Polar payments

The payment base is implemented and disabled by default. The dedicated Billing page
(`/billing`, available in the sidebar, account menu and balance display) supports Owner
subscription/seat management, manual USD top-ups, invoices/payment methods through the
Polar portal, members, spending limits and balance history. Admins can inspect finances;
financial changes and portal access are Owner-only.
Server placeholders are in root `.env` and `.env.example`; no live keys were added.
Follow [Polar setup and activation](docs/polar-payments.md) for products, signed webhooks,
worker processing, the $5 monthly allowance and remaining sandbox qualification.

Generation pricing uses the verified [October 28 rate card](docs/generation-pricing.md),
with configurable 20% supplier-cost markup, captured video receipts and cache-aware
DeepSeek peak/off-peak settlement.

## Internationalisation

The web app and admin panel support English, French, Spanish, Korean, Japanese,
and Simplified Chinese. Change language in web Settings or the admin top navbar
without losing unsaved form or editor state. Both sign-in screens also offer
a language selector. See [internationalisation](docs/internationalisation.md)
for catalogs, validation, and the budget-capped DeepSeek translation workflow.

## Admin permissions

Admin roles are managed under Administration in the separate Admin app. Existing
`isStaff=true` accounts without an explicit role assignment retain platform
administrator permissions. Ordinary accounts never inherit Admin permissions from
workspace ownership or workspace roles.

- Platform administrator: all current Admin permissions, including role management,
  company workspace management, and audit history.
- Support: user and workspace directories and user details.
- Billing: directories, workspace financial details, account lookup, and usage credits.
- Moderation: directories and moderation decisions.
- Operations: directories, overview, provider health, egress, and incident acknowledgement.

Roles can be combined. Explicitly selecting no roles revokes Admin access. A
platform administrator cannot change their own roles. Role changes require a
verified target account, a reason, and an idempotent request ID; the transaction
records the previous and new roles in the audit log. Backend permission checks
apply to each request. Navigation refreshes periodically; existing authorization
sessions do not preserve revoked privileges.

Audit history supports server-side actor, action, target, and date filters with
cursor pagination. Legacy entries remain readable. The schema additions must be
deployed before the updated API and Admin build. No existing financial records or
media are migrated by this permissions release.

## Operations overview

The Admin Overview is available to Operations and platform administrators. It
shows database/API reachability, worker instances, ready and scheduled tasks,
expired leases, failed work, uncertain submissions, and generation/payment review
counts. Observation times and unknown/stale states are explicit. Counts are
bounded to 1,000 records per indexed category and display `+` when capped;
worker details show the 50 most recently observed instances. Hourly failure counts
exclude legacy failures without a completion timestamp.

Workers publish an independent process heartbeat every 20 seconds, including
instance ID, optional `RELEASE_VERSION`, active workload, and last successful queue
poll. A live busy worker is distinguished from an idle worker whose polling has
stalled. Graceful shutdown records a stopped instance. Worker records older than
seven days are removed in bounded batches; the overview lists the last 24 hours.

A Convex cron evaluates monitoring every minute, independently of the Bun worker.
It creates one incident per persistent condition, preserves acknowledgement,
records recovery, and creates a new occurrence when the condition returns.
Operations staff can acknowledge incidents with an audited reason. Platform
administrators can configure monitoring, expected workers, heartbeat staleness,
backlog/overdue thresholds, and hourly generation failure thresholds. Configuration
updates use idempotent request IDs. Pausing monitoring preserves existing incidents.
Defaults are one worker, 90-second staleness, 100 ready tasks, five-minute queue
age, and five failed generations per hour. Worker-loss detection has an initial
staleness grace period. Alerts are recorded in Admin; no outbound notification
integration is configured by this release.

`GET /health` is API liveness. `GET /ready` checks the Convex dependency with a
two-second deadline and returns 503 when unavailable; probes are cached for five
seconds. Neither endpoint performs paid provider requests. Readiness does not
claim that workers or external providers are healthy. External uptime monitoring
can use `/ready` to detect API outages independently of the Admin app.

Deploy the additive Convex schema/functions and monitoring cron before restarting
the API/worker and serving the updated Admin build. A worker heartbeat is not a
replacement for the task lease heartbeat. No job retry, refund, or resubmission
actions are introduced by the overview.

## Generation job operations

Admin Jobs provides indexed, cursor-paginated search by job ID, creator email/ID,
workspace, project, model family/provider, status, and creation date. Attention
filters surface uncertain/in-flight submissions, billing review flags, and active
jobs with no state update for at least 15 minutes. These are review candidates,
not a declaration that a long-running provider request has failed. Batches read
at most 500 rows or 2 MB; filtered batches may be empty while more records remain.
Provider names identify the model family and do not replace historical supplier
receipts. New video and text jobs record workspace IDs. Before enabling historical
workspace filters, run the internal `adminJobs:backfillWorkspace` mutation in
bounded pages with `paginationOpts: {cursor: null, numItems: 50}`, then repeat with
the returned `continueCursor` until `isDone`. Missing-project records cannot be
assigned a workspace automatically; they remain searchable by other fields.

Support, Billing, Operations, and platform administrators can inspect operational
job metadata. Financial amounts and ledger entries additionally require billing
read permission. Only platform administrators can retrieve private prompts/error
details through a separate reason-required, audited action. Storage URLs and
private media are not exposed by job inspection. Lifecycle events are recorded
for new transitions; older jobs retain partial history. Detail views show recent
100 lifecycle events, 50 Admin actions, and 25 observations/review notes.

Operations staff and platform administrators can:

- Check an active provider request: performs only a provider poll and records a
  version-bound observation. Unknown/unavailable results are never treated as a
  confirmed provider failure. This does not submit, collect, settle, or refund.
- Resume tracking: requires a positive observation under five minutes old for
  the unchanged job, provider request, model version, and attempt state. Active
  worker leases, duplicate tasks, and recent in-flight submissions block recovery.
  The transaction replaces pending/failed dispatch with tracking-only work and
  permanently disables automatic resubmission of that job. Recovered polling
  failures retain funds for review; successful completion follows the existing
  receipt and settlement checks.
- Cancel before submission: restricted to queued jobs with an input snapshot,
  zero attempts, an explicit submission-fencing marker from the current creation
  path, no provider request/submission state, and no worker lease. Legacy jobs
  without this marker require review rather than an assumed cancellation.
  Reservation release, task removal, terminal state, event, and audit are atomic.
- Record a review note: retains evidence references without changing billing or
  inventing a provider outcome.

Recovery writes require reviewed reasons and idempotent request IDs. Retries
cannot release reservations twice or enqueue duplicate recovery work. Admin does
not provide a new paid-generation action, arbitrary provider-ID attachment, or
manual clearing of uncertain outcomes. Completed-job financial reconciliation
belongs to the subsequent Billing phase. Deploy schema/functions and backfill
historical workspace IDs before restarting API/worker and serving the new Admin
build. Existing media, financial history, and saved project work are preserved.

### Admin Phase 4: billing and reconciliation

The Admin **Billing** section requires `billing.read`; credits, derived-total repairs,
payment-event retries, refund requests, and review resolution require `billing.write`.
Workspace pages show available/reserved/spent/funded USD, subscription state, and
paginated ledger, order, funding-pool, checkout, and refund histories. Ledger search
matches an exact job ID, request ID, or reason; filtered pages may be empty while
more results remain. Checkout URLs are deliberately excluded from staff responses.
Payment environment appears on both events and workspace details.

Account credits append an audited, idempotent adjustment to the selected workspace.
They are separate from generation reservation releases (Jobs) and payment-method
refunds (Billing order history). Failed payment events can be requeued with a reason;
processed, already queued/running, and wrong-environment events are rejected. The
worker fetches authoritative Polar records and retains existing credit deduplication.

Interactive accounting audits are capped at 1,000 ledger entries and 3,000 stored
spend scopes. A partial audit never enables repair. Larger workspaces need an offline
operator audit. Rebuilds reconstruct derived balances and spend totals from the
entire bounded ledger and check its sequence again in the repair transaction;
invalid authoritative ledger evidence requires investigation rather than a balance
write. Missing supplier charges and stalled reservations remain linked to the Jobs
review queues. Staff cannot invent supplier costs or release uncertain submissions.

Polar refunds record a durable intent before the single external dispatch. The SDK
performs one request; network failures or conflicting receipts leave an unresolved
intent. Repeating a request never reissues that refund, and another unresolved
intent or provider-pending refund blocks a new request for the order. **Check refunds**
reads provider metadata/IDs and refreshes the authoritative order; absence from the
bounded provider result is not evidence of failure. Refund requests place the
workspace in payment review, preventing further generation. Staff must review used
funds/subscription consequences and explicitly resolve the review with a reason.
Clearance requires terminal refund intents, confirmed cumulative order accounting
for successful refunds, a consistent ledger, and the correct deployment environment.
The former internal `payments:clearReview` shortcut is removed.

Rollout: deploy the Convex schema/functions before restarting the API and workers,
then rebuild/restart Admin. Configure the matching Polar environment and credentials;
sandbox financial records remain isolated from live generation. Automated tests mock
Polar and never issue real refunds. Existing records need no Phase 4 backfill.

### Admin Phase 5: account controls and support

The **Support** section provides a case queue (open, investigating, waiting, resolved),
assignment to an active support administrator, append-only internal notes, and user/
workspace membership summaries. The user and workspace directories link directly to
these histories. Reads require `support.read`; case and note writes require
`support.write`. Platform administrators and the Support role have these permissions.
Financial roles do not gain access to private support notes. Support metadata access
does not confer project membership, private prompt access, payment permissions, or
customer impersonation. Notes must not contain credentials or payment details.

Platform administrators additionally have `accounts.manage` and can apply/reverse
customer account suspension, pause account generation, pause workspace production,
and revoke customer sessions. Every change requires a reason, an idempotency key,
and the currently displayed control revision. Case updates similarly require the
current case revision. Stale edits and changed request replays are rejected. Staff
accounts cannot be restricted through these controls, and suspended customers cannot
be promoted until restored. Use Administration for staff access changes.

Suspension rejects product access and verified sign-in/session creation. An existing
session can read its generic suspension state so the web app can show a clear notice
and sign-out action. Restoring an account reverses suspension; session revocation is
an independent action. Revocation installs an immediate server-side session cutoff,
including already-issued bearer tokens, and queues bounded expiration batches for
old authentication sessions. A newly signed-in session after the cutoff remains
valid. Previously issued upload sessions also fail their subsequent authorization
checks after revocation or suspension.

Generation pauses reject new video/text reservations. Workspace production pauses
also reject production edits, new uploads, and completion of existing upload
sessions, including in company-funded workspaces. Read access, workspace membership
administration, billing management, and share-link revocation remain available.
A proven unsubmitted video job is refunded once if a restriction is applied before
its submission gate. Legacy/ambiguous submissions retain their holds for review;
accepted provider jobs keep their existing tracking and settlement paths. Restrictions
never erase supplier evidence or change completed charges.

Rollout: deploy Convex schema/functions, restart API/workers, and rebuild/restart Admin
and web. Phase 5 fields are optional for existing accounts; no backfill is required.

### Admin Phase 6: moderation and storage

Moderation now has paginated status, stage, and verdict filters; moderator assignment;
and audited resolve, dismiss, and reopen decisions. Updates use a revision and an
idempotency key. Decisions never resubmit blocked work or implicitly change media
retention. Queue responses, including the older staff queue endpoint, omit private
snippets. **Read moderation evidence** requires `moderation.content.read`, a reason,
and an audit entry. Platform administrators and Moderation staff have this permission.
The prior simple queue screen has been replaced.

Storage provides a workspace-filtered R2 inventory and a separate inventory of
registered Convex media. Byte/file counts describe the displayed page, not an entire
workspace or bucket. Convex pages may contain fewer entries while more pages remain
because R2-backed registry rows are excluded. File inspection shows bounded alias and
publication references. Raw object keys and bucket credentials are not returned by
these Admin queries. `storage.read` permits metadata inspection for Platform,
Moderation, and Operations roles; permanent cleanup requires `storage.manage`, which
is reserved for Platform administrators. Workspace details link to their inventory.

Moderators can quarantine media or place it under a retention hold with a recorded
reason and current revision. Controls apply to the physical file across aliases.
Quarantine blocks new app URL issuance, newly admitted shared/owner export delivery,
and new input-reference use. New generation jobs snapshot their input asset IDs and
recheck quarantine before submission; proven unsubmitted jobs release their hold once.
Existing accepted or ambiguous provider work retains its reconciliation path. Older
jobs without an input snapshot cannot receive this new per-input submission check.
Previously issued direct storage URLs and already-loaded media may remain usable;
quarantine is not a remote revocation of those URLs. Audited media previews deliberately
bypass quarantine for authorized review. R2 preview URLs expire in five minutes;
Convex previews use that storage platform's native URL behavior.

Both quarantine and retention holds block logical/raw deletion, publication retention
cleanup, and account deletion/purge. Account purge checks holds before removing
ownership/reference metadata, including a second check when queued purge work runs.
Automatic unassigned-file cleanup skips held files. A separate audited media-control
update releases a hold; a moderation flag decision alone never does.

Permanent Admin cleanup is limited to R2 files older than 48 hours with no asset,
media registry, publication, staged-publication, or upload-session references. It
records a durable request and worker task before external deletion. Workers recheck
the exact file identity, holds, and live references before removing the object;
completion is recorded only after R2 confirms success. Failed requests remain pending
and can be requeued with a reason, without duplicating active work. Admin does not
bulk-delete assets or automatically erase legacy JSON/timeline storage. Normal
asset deletion continues to protect shared media and saved timeline history.

Rollout: deploy Convex schema/functions first, then restart API/workers and rebuild
Admin. The new tables/indexes and optional generation input snapshot require no
backfill. Tests mock object deletion and signing; no real objects are deleted during
verification. Localization catalog and source coverage now pass `bun run check:i18n`.

### Admin Phase 7: provider, model, and spend controls

**Provider controls** requires `providers.read`. Platform administrators configure
policies with `providers.configure`. Operations staff additionally have
`providers.pause`, which permits emergency pauses but cannot resume work or alter
limits. Global, provider (`sume`, `deepseek`), and application-model policies compose:
an enabled model cannot override its provider or the global pause. Changes require
a reason and idempotency key; configuration also checks the displayed revision.

Policies can pause new paid work, cap a request's authorized retail USD amount,
limit UTC daily/monthly committed USD, or limit outstanding reservations. Blank
means unlimited; zero prevents new admission. Admission runs inside the same Convex
transaction that reserves funds, so simultaneous requests contend against the same
remaining capacity. Company-funded work is included at its standard authorized
retail price. Existing workspace/project/series budgets, payment requirements,
account restrictions, moderation controls, and sandbox protections still apply.

Daily/monthly counters use application ledger settlement dates in UTC. Committed
usage is settled retail usage in that period **plus all outstanding reservations**,
including older holds across day/month boundaries. Missing supplier receipts and
billing-review holds stay committed until authoritative release or settlement.
These are application admission limits, not a provider invoice meter or a guarantee
of external charges. Supplier invoices may have different timing and amounts.

Lowering a limit preserves already-admitted work. Pausing also stops proven
unsubmitted video jobs at their dispatch fence and releases their reservation once.
Accepted/uncertain provider jobs continue tracking and reconciliation; admitted text
analyses finish their existing reserved stage. Pauses do not create new retries,
switch suppliers, erase receipts, or alter historical price snapshots. The product
shows a generic model-availability notice without exposing business limits or
internal incident reasons.

Before aggregate limits can be enabled, use **Initialize or resume accounting**.
A durable worker task scans jobs in stable, bounded pages and derives counters from
authoritative reservation/release entries. Concurrent live settlements reconcile the
whole job idempotently, preventing missing or double-counted holds during backfill.
Initialization can resume a failed worker task; suspicious missing/duplicate ledger
evidence blocks readiness for operator investigation. When a missing reservation
identifies a job, the page links to its Job detail. Running initialization again is
idempotent; aggregate admission fails closed until the scan finishes. It does not
repair malformed financial evidence or manually edited aggregate tables.

The Admin page includes deployed model IDs, provider mapping, UTC usage, current
limits, accounting progress, and a read-only deployed rate card/version. Credentials
and supplier routing remain server configuration. Prices are not editable here;
existing job price/markup/rate snapshots are preserved. Account deletion and queued
purge now also reject outstanding financial reservations, preserving the evidence
needed for reconciliation. Completed usage counters survive account-data purge.

Rollout: deploy schema/functions, restart API/workers, rebuild Admin/web, then run
accounting initialization before setting daily/monthly/outstanding limits. Pauses
and per-request ceilings work before initialization. No default caps are enabled.
Tests use database fixtures and provider mocks; this phase performs no paid calls.

### Admin Phase 8: analytics and reporting

**Analytics** creates durable reports for 1–90 completed UTC days, optionally scoped
to one workspace. Worker tasks scan indexed sources in bounded pages; a failed task
can resume from its committed cursor, or a running report can be canceled. Only
completed aggregates are readable/exportable. Reports expire after 30 days with
bounded deletion of aggregates and private distinct-account deduplication records.

Platform administrators and Billing have `analytics.read`, `analytics.run`,
`analytics.export`, and `analytics.financial`. Operations has the first three;
financial metrics are filtered on the server in detail, grouping, and CSV responses.
Support and Moderation cannot access reports. Build, cancellation, resumption,
deletion, and exports require reasons and are audited. CSV exports protect against
spreadsheet formulas and reject groups above 1,000 rows or 1 MB without truncation.

Reports cover surviving new accounts/workspaces, generation and starter/export
activity, equal-period returning active accounts, job outcome/timing coverage,
ledger settlements, supplier cost evidence, paid-order cohorts, current registered
storage, and recorded egress. Groupings are daily, workspace, model, and provider
where the source supports them. Distinct accounts exclude current staff/anonymous
accounts. This is not a complete signup funnel or historical cohort-retention
system. Deleted records and unrecorded activity cannot be reconstructed.

Ledger usage excludes manual credits and separates company-funded standard usage.
Known supplier costs and matched customer charge/cost spread include coverage
counts and exclude missing receipts. Payment order amounts and cumulative refunds
are separate for production/sandbox; they are not period cash revenue, recognized
revenue, MRR, ARR, or gross profit. Storage reflects surviving registry records at
scan time, not the selected period's historical storage. Egress is recorded
estimates, with writes/local exports separate from transfers, not invoice data.

The source creation cutoff is captured when the report is requested. Mutable job
outcomes, refunds, and storage states are observed during the build interval; this
is not a cross-table historical snapshot. Finished aggregates remain unchanged.
No prompts, email addresses, media URLs, credentials, or raw provider responses
are exposed by report endpoints. Deploy Convex schema/functions and indexes first,
then restart API/workers and rebuild Admin. No external analytics service or paid
provider call is involved.

### Admin localization acceptance

Admin/account-access/billing messages and the public landing page use the shared
six-language catalogs. Pricing and report summaries use complete interpolated
messages; dates, numbers, and USD amounts use the selected locale. The localization
check also validates conditional message alternatives, action labels, navigation,
role labels, and analytics metric/dimension catalogs.

The 2026-10-29 local browser check covered all six languages, draft preservation,
report creation through the real worker, grouped results, audited CSV download,
Admin operational views, public-page navigation wrapping, and `/dev` returning
Page not found. Evidence and explicit coverage limits are recorded in
[the acceptance results](docs/evidence/admin-localization/acceptance.json).
Live roles, funds, refunds, media deletion, and provider controls were not changed.
Role and financial-permission boundaries remain covered by automated tests.

Docker deployment configuration, per-service environment templates, production Convex tooling, and rollout/rollback instructions are available in [the deployment runbook](deployments/README.md).

See [brand and infrastructure transition](docs/brand-transition.md) for new Dirrio infrastructure configuration and saved-data compatibility.

## Product support

The web app includes Help and support with persistent conversations, human handoff,
private attachments and translated messages. Admin → Support provides the inbox,
knowledge base and linked support cases. See [support configuration and rollout](docs/support.md).
