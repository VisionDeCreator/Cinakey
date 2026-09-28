# Cinakey

Browser-based AI video production pipeline (script → look → blockout → shot generation → edit → export). Monorepo: Vite + React front end, Convex back end.

## Prerequisites

- Node.js 20+
- npm
- A [Convex](https://convex.dev) account
- (Optional) Google Cloud OAuth client for Google sign-in
- (Optional) [Resend](https://resend.com) API key for email notifications
- (Production) Vercel account (or another static host) and a custom domain

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

Google OAuth (optional; email/password works without it):

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
| `RESEND_API_KEY` | Outbound email (job/export notifications) |
| `EMAIL_FROM` | From address, e.g. `Cinakey <noreply@yourdomain.com>` |
| `USE_MOCK_ADAPTERS` | `true` = delayed sample outputs (no spend) |
| `ALLOW_DEV_CREDITS` | `true` = non-staff can use self `grantDev` |

Staff: set `users.isStaff = true` in the Convex dashboard. Staff UI: `/staff`. Dev tools: `/dev`.

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

### Production Convex

1. Create a **separate** Convex production deployment (do not reuse the `convex dev` deploy).
2. From `packages/backend`, deploy and set env for **production**:

```bash
cd packages/backend
npx convex deploy
npx convex env set SITE_URL https://your.domain
npx convex env set JWT_PRIVATE_KEY -- "..."
npx convex env set JWKS -- '...'
npx convex env set OPENAI_API_KEY ...
npx convex env set SEEDANCE_API_KEY ...
npx convex env set DEEPSEEK_API_KEY ...
npx convex env set GENERATION_WEBHOOK_SECRET ...
npx convex env set RESEND_API_KEY ...
npx convex env set EMAIL_FROM "Cinakey <noreply@yourdomain.com>"
npx convex env set USE_MOCK_ADAPTERS false
npx convex env set ALLOW_DEV_CREDITS false
# Google OAuth if used — update redirect URIs to the prod convex.site URL
```

3. Confirm the generation webhook URL is `https://<prod-deployment>.convex.site/webhooks/generation`.
4. Confirm the daily purge cron appears in the Convex dashboard.

### Static hosting (Vercel)

1. Create a Vercel project for this repo.
2. Set root directory to `apps/web` (or use Turborepo filter).
3. Build command (from monorepo root if configured that way):

```bash
npx turbo run build --filter=@cinakey/web
```

4. Output directory: `apps/web/dist` (or Vercel’s default for Vite when root is `apps/web`: `dist`).
5. Set build-time env `VITE_CONVEX_URL` to the **production** Convex URL.
6. Attach your custom domain. SPA rewrites are in `apps/web/vercel.json`.
7. Update Google OAuth origins/redirects to the custom domain and prod Convex callback.

Alternatively from `packages/backend`:

```bash
npx convex deploy --cmd 'npm run build -w @cinakey/web' --cmd-url-env-var-name VITE_CONVEX_URL
```

### Security pass (before launch)

- [ ] No secrets in `VITE_*` or client bundles (only `VITE_CONVEX_URL`).
- [ ] Every public Convex function checks auth / project access / `requireStaff` as appropriate.
- [ ] `ALLOW_DEV_CREDITS=false` and `USE_MOCK_ADAPTERS=false` on production.
- [ ] Webhook HMAC secret set; Resend domain verified.

### Launch checklist (manual)

1. Prod Convex deployment + all secrets above.
2. Vercel (or other host) deploy with custom domain + `VITE_CONVEX_URL`.
3. Set your user `isStaff: true` in the **prod** dashboard.
4. Smoke: sign up → starter template → export MP4.
5. Staff: grant credits with a reason; open a moderation flag; check provider health.
6. Confirm non-staff gets an error calling staff functions.
7. Test a job-failure email via Resend.
8. One real Seedance job and one GPT Image job on a throwaway project.

## Notes

- `apps/web/.env.local` should only contain `VITE_CONVEX_URL`.
- `packages/backend/.env.local` must contain `CONVEX_DEPLOYMENT`. The Convex CLI may also write public `CONVEX_URL` / `CONVEX_SITE_URL` there; do not rely on those from the web app.
- Storage goes through `packages/backend/convex/storage.ts` only. Model calls go through `packages/backend/convex/adapters`.
- Web imports Convex `api` from `@cinakey/backend` and shared types from `@cinakey/shared`.
- New users receive **100 starter credits** once per workspace. Rejected (unselected, unstarred) takes older than **30 days** are purged daily.
- Email notifications can be turned off in Settings.
