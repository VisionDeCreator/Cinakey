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
references block generation before credits are reserved. The current video
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
background work. Convex provides authentication, database transactions and file
storage. Rendering and MP4 encoding remain in the browser.

## Setup

Requires Bun 1.3.14+, a Convex account, and optionally Google OAuth/provider keys.

```sh
bun install --frozen-lockfile
cp .env.example .env
cp apps/web/.env.example apps/web/.env.local
cp packages/backend/.env.example packages/backend/.env.local
bun run dev:convex
```

Preserve existing environment files if already configured. Set the printed
Convex URL in root `.env` (`CONVEX_URL`) and the web environment
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

Google's callback remains
`https://<deployment>.convex.site/api/auth/callback/google`.
Provider keys are loaded exclusively from the ignored root `.env`; missing live
keys fail validation instead of silently producing mock responses.
Provider, email and generation-webhook secrets belong to the API/worker root
`.env`, not Convex or the browser. Use `USE_MOCK_ADAPTERS=true` for local
validation without paid model requests. Match that flag in Convex; set Convex's
`STAGING_LLM_ENABLED=false` when no DeepSeek key is configured.

From the root:

```sh
bun run dev
```

Or run `dev:api`, `dev:worker`, `dev:web` and `dev:convex` separately. The web app
opens at localhost:5173 and the API at localhost:3001 (`GET /health`).

## Layout

```text
apps/web/                 React + Vite creator app
apps/api/                 Elysia API, domain services and model providers
apps/worker/              Bun background process
packages/backend/         Convex Auth, schema and transactional persistence
packages/shared/          Domain types, schemas, prompts, 3D/timeline algorithms
packages/config/          Shared TypeScript, ESLint and formatting configuration
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

Staff accounts still use `users.isStaff=true`; staff tools are at `/staff` and
`/dev`. New workspaces receive 100 starter credits. Saved edits protect their
source media. Settings controls email preferences.

See [production safety and workflow](docs/production-safety.md) and the
[video provider contract](docs/provider-contract.md) for save recovery, media
retention, spending limits, supported provider operations and validation.

## Genjutsu

Open **Genjutsu** in the main sidebar to work with video transformations in a
standalone section. Create a transformation session, upload source footage and
image references, then use its dedicated source, comparison, version-history and
transformation-control layout. Sessions do not require a project or series, do
not appear in Projects, and cannot become series episodes. Their uploaded media
stays separate from the general project asset library. The project inspector no
longer contains transformation controls.

Recast a character, restyle footage, or change its environment using the existing
Seedance provider. The prompt determines what changes by default. Optional checkboxes can combine
characters, visual style, environment, clothing, objects/products, and lighting
in one request. Image references are optional; select up to eight in their desired
reference order. Type `@` in **Describe the change** to open the image picker,
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
with `deepseek-flash`, then submits the transformation to Seedance automatically.
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
4–30 seconds long. It requests the nearest whole-second output duration, 720p or
1080p, with adaptive aspect ratio. Camera and motion preservation are prompt
instructions, not tracked masks or guarantees. Precise isolated object replacement
and automatic shot-boundary detection are not implemented. Fast actions between
sampled frames may be missed.

Sessions live in `genjutsuSessions`. An isolated infrastructure scope marked
`purpose: genjutsu` reuses existing asset storage, generation workers and credit
accounting; these scopes are excluded from production-project listings and routes.
Generation notifications link back to the session. Rendering retries reuse the
request ID. Outputs retain source lineage; input snapshots include the versioned
plan, analysis model, sample times and selected references. Original footage stays
intact. Compare versions and open/download the selected result within Genjutsu.
