# Cinakey

Browser-based AI video production: script → image references → 3D staging →
video generation → edit → export.

Upload images or reuse existing assets as references. Cinakey does not generate
images or provide a conversational copilot. Projects open on Video; Script,
References, Staging, and Edit remain available throughout production.

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
`/dev`. New workspaces receive 100 starter credits. Worker retention scheduling
purges eligible rejected takes after 30 days. Settings controls email preferences.
