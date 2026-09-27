# Cinakey

Browser-based AI video production pipeline. Phase 1 is an empty signed-in studio shell on Vite + React + Convex, structured as an npm workspaces + Turborepo monorepo.

## Prerequisites

- Node.js 20+
- npm
- A [Convex](https://convex.dev) account
- (Optional) Google Cloud OAuth client for Google sign-in

## Setup

```bash
npm install
```

Create local env files (never commit secrets):

```bash
# packages/backend/.env.local — Convex deployment selector
cp packages/backend/.env.example packages/backend/.env.local

# apps/web/.env.local — public Convex URL for Vite
cp apps/web/.env.example apps/web/.env.local
```

Link or start the Convex backend (from the backend package):

```bash
npm run dev -w @cinakey/backend
```

`convex dev` writes `CONVEX_DEPLOYMENT` into `packages/backend/.env.local`. Copy the printed deployment URL into `apps/web/.env.local` as `VITE_CONVEX_URL` (public metadata, not a secret).

Then from the repo root, start Convex and the web app together:

```bash
npm run dev
```

Open http://localhost:5173.

### Auth secrets (Convex env only — never in `.env` files)

Run these from `packages/backend` (or with `-w @cinakey/backend`):

```bash
cd packages/backend
npx convex env set SITE_URL http://localhost:5173
npx convex env set JWT_PRIVATE_KEY -- "<paste PKCS8 key with spaces for newlines>"
npx convex env set JWKS -- '<paste JWKS JSON>'
```

Google OAuth (optional for Phase 1; email/password works without it):

1. Create a Google Cloud OAuth client (Web application).
2. Authorized JavaScript origins: `http://localhost:5173`
3. Authorized redirect URI: `https://<your-deployment>.convex.site/api/auth/callback/google`
4. Set secrets:

```bash
npx convex env set AUTH_GOOGLE_ID <your-google-client-id>
npx convex env set AUTH_GOOGLE_SECRET <your-google-client-secret>
```

Provider API keys and job flags are Convex env vars only (`npx convex env set` from `packages/backend`). Never put secrets in `VITE_*` variables or commit them to the repo.

| Env var | Purpose |
| --- | --- |
| `OPENAI_API_KEY` | GPT Image 2 |
| `SEEDANCE_API_KEY` | Seedance 2.5 (ByteDance) |
| `SEEDANCE_API_BASE_URL` | Optional API host override |
| `DEEPSEEK_API_KEY` | DeepSeek chat |
| `GENERATION_WEBHOOK_SECRET` | HMAC for `POST /webhooks/generation` |
| `USE_MOCK_ADAPTERS` | `true` = delayed sample outputs (no spend) |
| `ALLOW_DEV_CREDITS` | `true` = non-staff can use self `grantDev` |

Staff: set `users.isStaff = true` in the Convex dashboard. Dev hub (staff): `/dev` (grant credits by email). Other signed-in tools: `/dev/upload`, `/dev/generation`.

### Scripts (from repo root)

| Command | Purpose |
| --- | --- |
| `npm run dev` | Turborepo: Convex + Vite together |
| `npm run build` | Build all packages |
| `npm run lint` | ESLint across packages |
| `npm run typecheck` | TypeScript across packages |
| `npm run test` | Vitest across packages |
| `npm run format` | Prettier |

Package-level scripts still work, e.g. `npm run dev -w @cinakey/web` or `npm run test -w @cinakey/backend`.

## Layout

```
apps/web/                 React + Vite app (@cinakey/web)
packages/backend/         Convex project (@cinakey/backend)
packages/shared/          Shared types (@cinakey/shared)
packages/config/          Shared tsconfig / ESLint / Prettier (@cinakey/config)
```

Later (not yet): `apps/admin`, `packages/ui`.

## Deployment

- **Static hosting** (Vercel / Netlify / Cloudflare Pages): build `apps/web` with `turbo run build --filter=@cinakey/web` (or set the project root / filter to `apps/web`). Inject `VITE_CONVEX_URL` at build time (e.g. `npx convex deploy --cmd '…' --cmd-url-env-var-name VITE_CONVEX_URL` from `packages/backend`).
- **Convex**: deploy from `packages/backend` (`cd packages/backend && npx convex deploy`).

## Notes

- `apps/web/.env.local` should only contain `VITE_CONVEX_URL`.
- `packages/backend/.env.local` must contain `CONVEX_DEPLOYMENT`. The Convex CLI may also write public `CONVEX_URL` / `CONVEX_SITE_URL` there; do not rely on those from the web app.
- Storage goes through `packages/backend/convex/storage` only. Model calls go through `packages/backend/convex/adapters` (stubs in Phase 1).
- Web imports Convex `api` from `@cinakey/backend` and shared types from `@cinakey/shared`.
