# Video provider contract

Cinakey uses Sume for video generation. Configure `SUME_API_KEY` in the ignored
root `.env`, set `ENABLED_PROVIDERS=deepseek,sume` and `USE_MOCK_ADAPTERS=false`.
While the USD rate card is provisional, real provider access also requires the explicit
`ALLOW_DEVELOPMENT_PRICES=true` development opt-in.
API and worker processes load that same file. Keys never enter browser bundles or
Convex environment settings. The legacy enabled-provider name `seedance` maps to
`sume`; Ark keys, model overrides and regional URLs no longer select a video provider.

The integration follows [Sume's API documentation](https://www.sume.com/docs) and
its authenticated model catalog, verified October 26, 2026. Requests use bearer
authorization against `https://api.sume.com`. Successful responses wrap their
payload in `data`.

## Routes and supported inputs

- Projects and series episodes keep the adapter ID `seedance-2.5` and submit to
  `POST /v1/video-router/generate` with `model: seedance-2.5`. The supported subset
  remains 4–30 whole seconds, 720p/1080p, optional seeds, up to 30 image references
  and one reference video. First/last frames use `image_url`/`end_image_url`;
  references use `reference_image_urls`/`reference_video_urls`. Frame mode and
  reference mode are mutually exclusive. Extension uses `video_url` and
  `extend: true`; its duration describes the added segment.
- Genjutsu uses adapter `sume-remix-lite` and
  `POST /v1/sume/remix-lite/object-swap/v1.0`. The original video is `video_url`;
  1–8 replacement images are `image_urls`. Source length must be 4–15 seconds,
  at most 200 MiB. Requested resolution is 720p or 1080p; source aspect ratio and
  timing are retained by the provider. Source duration is rounded **up** to whole
  seconds for reservation and the request; the source file is never truncated.
  Prompt-only rendering without a reference image is unavailable on this route.
  DeepSeek Flash still analyzes sampled frames before rendering. Real-person
  basketball footage was accepted in the authorized live evaluation.

Both adapters poll `GET /v1/jobs/{id}/status` and collect
`GET /v1/jobs/{id}/result`. Canonical `sume_status`/`job.status` take precedence;
transport states such as `IN_PROGRESS` and `COMPLETED` are also recognized.
Failed/canceled/expired jobs release reserved Cinakey USD. Unknown states or ambiguous
submissions require review and retain reservations instead of resubmitting blindly.
Only video artifacts are collected; poster images do not become duplicate outputs.
Cinakey downloads outputs into its own storage and reads MP4 metadata independently
because Sume artifact dimensions/duration can be null.

Each submission sends a stable `Idempotency-Key` derived from the Cinakey job ID
and attempt. Paid POSTs are never automatically retried on ambiguous transport
failure. Polling and collection share the existing bounded GET retries,
timeouts, cancellation, origin checks and secret redaction. Pre-migration Ark jobs
are held for review instead of sending their IDs or inputs to Sume. New output
lineage records `sume/seedance-2.5` or `sume/remix-lite/object-swap/v1.0`.

Customer accounting now uses integer micro-USD and versioned development prices;
analysis settles separately to reported usage, with missing usage retained for
review. Final D1 retail rates remain pending. See [USD accounting](usd-accounting.md)
for the provisional rates and pricing gate. Automated tests inject transports and
block paid network calls.

## Verification

Contract and application tests cover request fields, routing, job states, missing
artifacts, duration/reference limits, duplicate request reservations, refunds and
worker reconciliation. Existing historical Ark output assets remain accessible.

## Authorized live integration verification — October 26, 2026

This historical verification predates the USD accounting replacement; the credit
amounts below record that run and are not current prices or converted balances.
No new paid verification was performed for the USD batch.

Three 720p jobs completed against the configured Sume account using authenticated
Cinakey service actions, the real Convex job/credit records, worker polling,
media collection and permanent asset storage:

| Flow                   | Provider job                               | Stored output                       | Cinakey rendering credits |
| ---------------------- | ------------------------------------------ | ----------------------------------- | ------------------------- |
| Genjutsu / Remix Lite  | `job_34ff6fd5-861f-42f3-b3f7-8cf18f52e283` | 718×1280, 9.034 s, 15,409,311 bytes | 20                        |
| Project / Seedance 2.5 | `job_93b2f817-d649-4d8d-9fec-caa2d043816b` | 1280×720, 5.056 s, 5,920,773 bytes  | 10                        |
| Episode / Seedance 2.5 | `job_fd946bc7-8d40-4a5f-a0c0-c99883b8ba12` | 1280×720, 5.056 s, 5,929,778 bytes  | 10                        |

Genjutsu used the original real-person basketball clip and character turnaround,
including a real DeepSeek frame-analysis step. The duplicate application request
returned the same job ID. Project and episode tests used copies of an existing
character reference in isolated verification scopes, and exercised
`workspace.generate` with script-reference resolution. Output records contain
Sume model versions and reference/source lineage.

The test harness was interrupted while coordinating with the already-running
worker. The original idempotency keys recovered the two interrupted submissions;
provider job listing confirmed one provider job per Cinakey job. Normal worker
poll/collection operations completed all three, without additional generation.
Browser playback was checked against the files read back from Cinakey storage.
This verifies the backend pipeline and stored-video playback; the live jobs were
initiated through service actions rather than clicking Generate in the browser.

Sume captured $3.312 for these jobs ($1 Remix Lite and $1.156 per Seedance job).
Including the prior isolated provider evaluation, Sume test spend was $31.878,
within the authorized $50 cap. DeepSeek analysis uses its separate token billing.
The prior evaluation covered both 720p and 1080p; these application integration
smoke tests used 720p. Extension and first/last-frame field mappings have automated
contract coverage but were not separately generated in this live smoke test.
