# R2 media storage

Images, videos, logos and audio use a private Cloudflare R2 bucket. Convex keeps
asset records, ownership, immutable version references, upload sessions and file
metadata. Small JSON documents (scripts, timeline/staging snapshots and provider
checkpoints) continue to use Convex file storage. No file migration is required.

## Configuration

Set `R2_ACCOUNT_ID`, `R2_ENDPOINT`, `R2_BUCKET`, `R2_ACCESS_KEY_ID` and
`R2_SECRET_ACCESS_KEY` in the ignored root `.env` for local development, and in
both API and worker hosting secrets for deployment. Use separate buckets and
bucket-scoped Object Read & Write credentials for development and production.
Do not expose these values through `VITE_*` or set them in Convex.

Keep public `r2.dev` and public custom-domain access disabled. Configure the
bucket's CORS policy in **Cloudflare → R2 → bucket → Settings → CORS policy**:

```json
[
  {
    "AllowedOrigins": ["http://localhost:5173", "http://localhost:5174"],
    "AllowedMethods": ["GET", "HEAD", "PUT"],
    "AllowedHeaders": ["Content-Type", "Range"],
    "ExposeHeaders": [
      "ETag",
      "Content-Length",
      "Content-Range",
      "Accept-Ranges"
    ],
    "MaxAgeSeconds": 3600
  }
]
```

For production, replace the localhost origins with the exact creator/admin
origins. Match `WEB_ORIGINS` on the API and set each frontend's `VITE_API_URL`.
CORS permits browser requests; it does not make objects public. Object-scoped
credentials cannot configure bucket CORS; use the dashboard with an authorized
Cloudflare account.

Deploy the updated Convex schema/functions together with the API/worker and
web build. The existing development workflow is `bun run dev:convex` followed
by the API, worker and web processes. No production deployment or automatic
bucket-wide deletion is performed by this change.

## Upload and delivery

1. The authenticated API authorizes project/series write access in Convex and
   creates a one-hour upload session. Sessions are limited to 120/user/hour.
2. The browser submits MIME type and size, then uploads directly to R2 using a
   15-minute signed PUT URL. Existing type/size limits apply (25 MiB images,
   500 MiB videos; other media limits are in `convex/storage.ts`).
3. The API copies the staging object to an immutable media key. It verifies the
   stored size, MIME type and file signature before registering an `r2Files` row.
   A single completion claim prevents concurrent replacement. Repeated completion
   requests return the same file ID and retry staging deletion. After registration
   commits, the API immediately deletes the staging copy. A deletion failure does
   not fail the completed upload; delayed cleanup retries it. Asset registration
   retains workspace checks.
4. Authenticated asset queries return internal references that the HTTP boundary
   resolves to signed R2 GET URLs after a second asset/publication access check.
   Normal editor/provider URLs remain valid for 18–24 hours, with stable signing
   windows to avoid changing URLs on every query refresh. The HTTP query cache
   refreshes them during use. Signed URLs are bearer capabilities until expiry.
5. Generated media and validated published MP4 exports are written to R2 by the
   existing Bun services. Their metadata remains in Convex. Published export
   downloads and share GETs redirect to five-minute signed URLs, preserving range
   delivery without proxying media bytes through the API. Existing share gates
   apply before signing; an issued URL remains usable until its expiry.

The first version uses single PUT uploads with whole-file retry; resumable
multipart browser uploads are not included. Cloudflare Stream/transcoding and
automatic thumbnail generation are separate features.

## Retention and recovery

The Bun worker removes expired upload sessions after a 24-hour grace period,
queues deletion of their staging objects and unregistered final objects, and
processes file deletions through the durable `apiTasks` queue. Unregistered worker
media intents are also reclaimed after a 24-hour grace period. Shared asset and
published-export protections remain in place. R2 failures retry through the same
worker queue and terminal failures remain visible for inspection. The worker
must be running for cleanup to progress.

The immutable final key protects registered media from a still-valid staging PUT
URL. Keep upload-session tokens and signed URLs out of logs. Do not list the
bucket to build the media library; use indexed Convex metadata queries.

## Verification

Run `bun --no-env-file scripts/check-r2.ts` from the repository root. It tests
signed uploads, sealing, metadata/signature verification, content integrity,
range delivery and browser CORS for every `WEB_ORIGINS` origin. It deletes only
its randomly named temporary objects and never prints credentials or signed
URLs. Any failed check sets a nonzero exit status.

`bun run typecheck`, `bun run lint` and `bun run test` cover the contracts,
configuration, upload/session state, workspace isolation, deletion queueing and
existing generation/editor/export behavior.
