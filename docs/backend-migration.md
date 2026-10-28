# API migration and operations

Current product scope: see [Video production focus](video-focus.md). Copilot and
new image generation have been retired; historical references below describe
the original migration. Seedance and DeepSeek remain active providers.

Cinakey runs a Bun/Elysia API and a separate Bun worker. Convex retains Auth,
indexed persistence, transactions, media metadata and JSON file storage. Cloudflare
R2 stores media bytes; see [R2 setup](r2-storage.md). The browser retains 3D
rendering, media editing and MP4 encoding. Product behavior and provider models
are unchanged by this migration.

## Boundaries

- `apps/api/src/services`: application workflows extracted from Convex actions.
- `apps/api/src/providers`: all external model requests and mock adapters.
- `apps/api/src/app.ts`: authenticated, validated `/v1/:module/:operation` contracts,
  health endpoint and generation webhook. Only public manifest entries are routed.
- `apps/api/src/operations.ts`: type-only combination of service/persistence
  contracts. Generated Convex references are not the browser's application API.
- `apps/api/src/runtime`: request-scoped authenticated contexts and storage access.
  The small context interface preserves existing domain workflows during migration;
  it executes service handlers locally and never forwards an application action to Convex.
- `apps/web/src/lib/api`: shared HTTP query cache, write invalidation and NDJSON
  chat streaming. Convex React remains only for authentication.
- `packages/backend/convex`: auth, schema, indexed reads and transactional writes.
  `storage.ts` remains the common storage helper layer. No provider implementations
  or application actions are deployed here.
- `apiTasks` and `apiTaskSchedules`: durable dispatch, leases, retry metadata and
  daily retention scheduling. These are additive tables; existing IDs are preserved.

When adding an operation, update its service/persistence module and
`apps/api/src/manifest.json`. Include the module in `operations.ts` and the service
registry if it is new. Internal operations must stay absent from the public API.
The service builders preserve Convex validator/type syntax without registering
or executing a Convex action.

## Local development

Install Bun 1.3.14 or later. From the repository root:

```sh
bun install --frozen-lockfile
cp .env.example .env
cp apps/web/.env.example apps/web/.env.local
# Preserve the existing packages/backend/.env.local deployment selector.
bun run dev:convex
```

Set the actual Convex deployment URL in root `.env` and the web `.env.local`.
Create a deployment key in Convex and set `CONVEX_DEPLOY_KEY` in root `.env`.
The API validates a user's access token through Convex Auth before a local
service context uses the server credential. Each request has its own client;
identities and query caches are never shared across users.

Keep auth keys, OAuth secrets and `SITE_URL` configured in Convex. Provider,
webhook and email secrets now belong to the API/worker environment. Convex needs
only the non-secret `STAGING_LLM_ENABLED` flag for staging controls. Development funding and runtime mock-provider switches have been removed.
Set `STAGING_LLM_ENABLED=false` if the API has no DeepSeek key. Do not put the
deployment key, provider keys or webhook secret in any `VITE_*` variable.

Start all workspaces with `bun run dev`, or use separate terminals:

```sh
bun run dev:api
bun run dev:worker
bun run dev:web
```

The API defaults to port 3001; the web app defaults to 5173. Existing password
and Google sign-in still use Convex Auth, including its original OAuth callback.
Generation webhooks now target `https://<api-host>/webhooks/generation`.

## Worker guarantees and limits

Creating a provider job, reserving credits and dispatching its task is one Convex
transaction. Workers claim bounded batches with two-minute leases renewed every
30 seconds. Expired leases are reclaimed; stale owners cannot acknowledge tasks.
Provider polling runs in the worker and reuses request-local job reads instead
of creating a scheduled Convex invocation per poll. Job state changes persist;
on restart, jobs with a provider ID resume polling instead of resubmitting.
Generation callbacks deduplicate against the job's pending/running task. Credit
settlement/refund and terminal state updates are transactional and idempotent;
output rows and takes also deduplicate on recovery.

Idle workers back off to 30 seconds. A five-minute reconciliation pass recovers
missing dispatch for existing queued/submitted/running provider jobs. Terminal
queue failures remain visible in `apiTasks` after six attempts for operator
inspection; do not blindly resubmit a job whose provider outcome is uncertain.
External provider submission cannot be made exactly once without provider-side
idempotency/reconciliation. Ambiguous submissions are fenced for manual review;
accepted synchronous outputs are checkpointed before completion. See the provider
execution section below.

Copilot streams go directly to the initiating browser; complete messages are
persisted. A dropped browser connection does not cancel the running API handler.
The reconciliation pass marks request-bound text jobs older than 30 minutes as
interrupted, refunds the reservation once and clears any streaming message flag.
It does not automatically replay a conversation or its tool side effects.

Retention scheduling runs once per UTC day across workers. Media bytes use R2;
JSON checkpoints remain in Convex storage. R2 upload cleanup also runs during the
five-minute worker reconciliation pass.

## Deployment and cutover

1. Back up the existing deployment, pause new generation requests and let existing
   Convex jobs drain. Confirm no old application action is running. Keep the old
   code release available for rollback.
2. Configure the API/worker environment and a persistent process supervisor.
   Both processes need outbound access to Convex, storage and model providers.
   Allow streaming responses without buffering or short request timeouts.
3. Deploy the additive schema and persistence layer from `packages/backend` with
   `bunx convex deploy`. Refresh generated bindings with `bunx convex codegen`
   against the target deployment. This removes application actions, the generation
   HTTP route and the old retention cron; auth routes remain.
4. Start the API and worker against that same deployment. The startup reconciliation
   pass can recover queued provider jobs, but does not replace draining old actions
   before cutover. Never run old and new processing paths simultaneously.
5. Point provider webhooks to the API, set explicit `WEB_ORIGINS`, then deploy the
   web app with `VITE_API_URL` and the same `VITE_CONVEX_URL`.
6. Check password/Google login, project access, mock chat and generation, worker
   restart, credits, file upload/playback, saved script/blockout/timeline versions
   and browser export. Then enable live providers when ready.
7. Remove unused provider/email/webhook secrets from Convex after the new services
   are verified. Keep Convex Auth secrets and the non-secret flags described above.

To roll back, stop new submissions and the worker first, reconcile outstanding
jobs/credits, then restore the old backend and web release together. The new tables
and optional fields can remain; no destructive data conversion is required.

## Validation and cost baseline

```sh
bun run typecheck
bun run lint
bun run test
bun run build
```

Tests execute migrated service handlers against a real `convex-test` database and
exercise HTTP auth/visibility, streaming, worker leases, duplicate callbacks,
credit idempotency and private-project isolation. Mock providers avoid spending.
No production deployment or paid-provider call is part of local validation.

Before enabling the release, record Convex calls, database I/O, file egress and
latency for project load, chat, image/video generation and timeline save/export.
Repeat with the same fixtures after cutover and include API/worker hosting costs.
The old chat path wrote one mutation per stream delta; the new path writes the
final message. Savings elsewhere depend on workload and must be measured rather
than inferred from moving the HTTP boundary.

## Provider credentials and safe execution

Provider execution is owned by `apps/api/src/providers`. The API and worker start
with Bun's automatic dotenv loading disabled. Their entrypoints load the root
`.env` explicitly; provider keys in inherited environment variables or nested
`.env.local` files cannot override that file. The local file is ignored and should
have owner-only permissions. Commit only empty credential fields in `.env.example`.
For hosted deployments mount the private `.env` at the repository root. Auth
configuration and deployment selectors remain with Convex.

`ENABLED_PROVIDERS` selects `deepseek,seedance,openai`. Startup validates keys for
every enabled provider. Missing keys no longer
silently select fake responses. Keep mock mode explicitly enabled for development
until ready for real spending. Never enable paid mode as part of tests.

`PROVIDER_TIMEOUT_MS` bounds requests (including response streaming);
`PROVIDER_READ_RETRIES` bounds safe GET retries. The transport honors bounded
Retry-After delays, propagates browser/worker cancellation and refuses credential
redirects. Paid POSTs are not automatically retried by the transport. A clear
429 rejection can be retried by the durable job runner within its existing limit.
Provider bodies, authorization headers and signed URLs are omitted from errors;
known credential values are redacted before errors reach messages, records or logs.

The job runner writes an `in_flight` fence before a paid submission. A timeout,
network failure, ambiguous server response, or restart before acceptance is saved
moves the job to `submissionState=uncertain` and parks its task for review. Credits
remain reserved, and reconciliation does not resubmit the job. No undocumented
provider idempotency-header support is assumed. Accepted synchronous results are
checkpointed in Convex storage so another worker can finish without another paid
submission or an in-process result buffer. Temporary result checkpoints are deleted
once the job is completed or refunded, so images are not retained twice.

For an uncertain job, first check the provider using its dashboard/logs. If accepted,
record its provider job ID, set the submission state to `accepted` and resume the
existing task. If definitively rejected, set the state to `rejected` before explicitly
retrying. If abandoning the job, use the existing idempotent refund operation.
Never reset a submission fence merely because the client timed out.

API/backend tests install a rejecting network transport and clear inherited provider
keys. Provider tests can use only explicitly installed mock transports. Web tests
also reject unmocked fetch calls. Root `bun run test` runs the credential check
before tests. To check a proposed commit, run:

```sh
bun run check:secrets
bun run check:secrets -- --staged
```

The check rejects tracked `.env` variants, nonempty example credential fields and
common hardcoded credentials/private keys. It prints file paths and finding types,
never the matched secrets. It is a regression guard, not proof that historical Git
commits never contained credentials. Remove unused provider keys from the deployed
Convex environment after live cutover is verified; local code does not change
remote deployment secrets.

## Starting API, worker and Convex together

The worker may start before `convex dev` has uploaded the latest functions. It
waits with bounded backoff and one deployment warning, then resumes automatically
when `tasks:scheduleRetention` is available. Authentication errors remain errors;
worker functions must stay internal and must not be made public to hide a startup
failure.

A failing Convex typecheck prevents that upload. The backend typecheck script now
also runs with Node-only ambient types, matching Convex deployment more closely,
so Bun's additional types cannot mask ES2021 compatibility errors. Resolve those
errors and wait for Convex's deployment-ready message; keep the worker running or
restart `bun run dev` after the backend is ready. Root `CONVEX_URL` must point at
the same deployment as the web app and the backend deployment selector.
