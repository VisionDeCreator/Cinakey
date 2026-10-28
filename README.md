# Cinakey

Browser-based AI video production: script → image references → 3D staging →
video generation → edit → export.

Upload images or reuse existing assets as references. Cinakey does not generate
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

## Workspace teams

Settings → Workspace team supports verified-email invitations, member roles, removal,
and Creator project/series assignments. Invitations appear in the recipient's Settings
after they sign in with the verified invited email; this release does not send email.
Owners and Admins manage access, assigned Creators collaborate on production documents,
and Reviewers cannot open production files. Shared projects and episodes appear in
Projects. Removing a member revokes subsequent production requests and clears assignments.

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

Click **Generate** after uploading a video and writing a prompt. Cinakey decodes
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
with configurable 5% supplier-cost markup, captured video receipts and cache-aware
DeepSeek peak/off-peak settlement.
