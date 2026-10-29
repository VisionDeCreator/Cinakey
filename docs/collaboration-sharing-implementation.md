# Collaboration and video sharing implementation strategy

Status: A–D implemented and verified in development; see the [acceptance report](collaboration-acceptance-report.md). This reduced MVP supersedes the earlier Phase 1
requirement to implement review comments, approvals, designated approvers and review
notifications before launch. The [Polar base integration](polar-payments.md) is implemented with activation disabled.
Final rate validation and provider eligibility remain activation checks. Automated tests require no payments, provider calls or live emails. The authorized acceptance run also exercised real SMTP.

## Target workflow

Owner invites a teammate → teammate signs up and verifies email → Owner/Admin assigns
productions → one teammate edits a timeline safely → creator exports a saved edit →
Dirrio stores the finished video → a recipient watches or downloads through a revocable
link without creating an account.

## A — Onboarding and permissions

Dependencies: existing authentication, workspace roles, assignments and email transport.

- [x] Preserve the intended application destination through signup/sign-in and Google login.
- [x] Replace raw credential exceptions with useful messages; never silently create an account on sign-in.
- [x] Add explicit password-account email verification before invitation acceptance.
- [x] Store only a user/email-bound verification hash, expire codes after ten minutes,
      invalidate superseded codes and cap requests/attempts without rollback bypasses.
- [x] Queue invitation delivery transactionally, show delivery state and support controlled resend.
- [x] Keep acceptance tied to the verified invited email, current inviter permissions and expiry.
- [x] Expose Owner/Admin/Creator roles for the current MVP; defer Reviewer-specific UI.
- [x] Audit production/media/finance endpoints for the same permission rules as the UI.

Acceptance: wrong-account/expired/revoked invitations fail; unverified users can verify
and accept; no secret code appears in persisted task arguments or logs; disabled email
is reported honestly; removed members cannot initiate new protected work. Existing
password accounts remain usable; signup and sign-in stay explicit separate actions.

## B — Editing safety

Dependencies: production permissions; existing parent-version checks and local recovery.

- [x] Add an expiring per-project timeline lease tied to user and browser session.
- [x] Renew while editing, release voluntarily and expire abandoned sessions.
- [x] Check lease ownership/fencing in the save transaction alongside expected-parent checks.
- [x] Show editor identity and read-only state; preserve local work after access/lease loss.
- [x] Permit an explicit Owner/Admin takeover with an audit event; no collaborative cursors or branching.
- [x] Show saved-version authorship and restore by appending a new version.

Acceptance: two sessions cannot publish timeline edits concurrently; late/displaced
writers fail; retried committed saves are idempotent; a lease renewal never authorizes
an old browser session after takeover. Script saves retain optimistic conflicts and
local recovery; no real-time script co-editing is introduced.

## C — Stored exports

Dependencies: B; existing browser exporter, storage ownership and production permissions.

- [x] Render a specific saved timeline snapshot and record its version ID.
- [x] Create a publication intent with a retry-safe request ID and a bounded upload.
- [x] Validate uploaded MP4 size/type, playable metadata and configured output limits server-side.
- [x] Finalize immutable file metadata only after validation, with publisher identity.
- [x] Preserve local download when upload fails; retry finalization without duplicate publications.
- [x] Protect published media from normal asset cleanup; clean abandoned uploads separately.
- [x] Show stored exports and upload progress in the project export flow.

Acceptance: the recipient can play a complete export after the creator closes their
browser; later edits never change published bytes; interrupted uploads cannot be shared;
wrong-workspace files and uploads over storage limits fail before publication.

## D — Simple private sharing

Dependencies: C. Default: watch-only, unguessable link, no recipient account required.

- [x] Let Owners/Admins and assigned Creators create/revoke links for published exports.
- [x] Store a hash of the link secret; bind access to one immutable publication.
- [x] Add optional password, expiry and explicit download permission.
- [x] Exchange link/password for short-lived scoped sessions; recheck revocation on media requests.
- [x] Serve range requests through the API without exposing permanent storage URLs.
- [x] Add a public watch page and creator copy-link/revoke controls.
- [x] Keep credentials out of logs, referrers and analytics; rate-limit access attempts.

Acceptance: seeking works; unauthorized downloads, expired/revoked access and guessed
production IDs fail; viewers cannot access scripts, inputs, budgets or other exports.
Previously downloaded/buffered bytes cannot be revoked. No comments, annotations,
approvals, reviewer accounts or review-specific notifications are included.

## Verification and rollout

- [x] Complete meaningful automated tests per batch, then typecheck/lint/build/format.
- [x] Test two actual accounts/browser sessions: invitation, access removal, editing conflict and recovery.
- [x] Verify one uploaded export visually/audibly and open its link in a signed-out browser.
- [x] Test password, expiry, revoked link, download denial and HTTP range playback with database/API fixtures.
- [x] Repeat those checks with a newly rendered export in a signed-out browser.
- [ ] Deploy each verified schema/function batch without resetting user data.

## Local implementation status (October 27)

A–D are implemented locally. The [permissions audit](collaboration-permissions-audit.md)
records current role boundaries and the staff-access correction. Onboarding uses
Nodemailer SMTP for verification codes, invitations and workspace notifications.
The updated root `.env` SMTP configuration passes validation and live connection/authentication
verification. One requested test email was accepted by the SMTP server for the configured
sender/reply-to mailbox. Inbox placement has not been independently verified.
Automated tests mock SMTP and never connect to a mail server.

Leases last 90 seconds, renew every 20 seconds, and release when the editor closes.
Requests after an expired lease require an explicit retry; failed renewals make the
editor read-only. Saved versions show their author. Restores append a new version.

Stored exports use `publishedExports` with waiting/uploading/ready/failed states.
The API validates container, H.264/AAC tracks, packet presence, dimensions and duration
before staging a file and atomically publishing its immutable metadata. Validation runs
in the bounded upload request; a separate render/validation worker is not required.
The browser freezes the document when Export opens and requires it to match a saved
version. Local export telemetry in `exports.record` remains separate from publications.

The default upload limit is **200 MiB per video**, with **5 GiB of stored exports per
workspace**, up to **1080p long edge / five minutes**. Publication intents reserve
capacity atomically for one hour. Upload attempts hold a ten-minute lease; at most two
uploads run per API process. A retry after an unknown commit outcome checks publication
status rather than replacing published bytes. Failed uploads retain the downloaded MP4
and allow retry while the dialog stays open. Closing it discards the in-memory upload
retry; the downloaded file stays on the creator's device. Worker maintenance removes
expired intents, their bound staged files and expired viewer sessions every five minutes.
Unknown storage-write outcomes before a file is bound may require an operator orphan
check; never delete a possibly committed publication merely because an acknowledgement
was lost.

Owners/Admins and assigned Creators can download/delete stored exports and create/revoke
private links. Deletion disables every link for that publication. Links are workspace
resources: removing their creator's assignment prevents further management but does not
automatically revoke links already issued; another authorized teammate can revoke them.

Sharing defaults to watch-only and seven days in the UI; expiry can be omitted or set
within one year. Optional passwords require 8–128 characters and use salted scrypt hashes.
Link secrets contain 32 random bytes and are stored as SHA-256 hashes. Secrets appear in
the URL fragment and are exchanged in a POST body for an HttpOnly, path-scoped viewer
cookie lasting at most one hour. Every media/range request checks current revocation,
expiry, publication state and download permission. Revoked/expired access fails closed;
no public response reveals the storage URL or production/billing details. Credentials
must not be added to access logs, analytics or error reports. Share delivery counters
record admitted byte ranges, so interrupted downloads can overestimate delivered bytes;
these counters do not debit the generation wallet.

Watch-only hides explicit download controls; it cannot prevent a recipient from saving
or capturing bytes already delivered. Revocation controls future requests, not existing
buffers or downloaded files.

## SMTP configuration and deployment

Use root `.env` variables `EMAIL_NOTIFICATIONS_ENABLED`, `SMTP_HOST`, `SMTP_PORT`,
`SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM_NAME`, `SMTP_FROM_EMAIL` and
`SMTP_REPLY_TO`. The API and worker read them through the existing root environment
loader; no SMTP secrets belong in `VITE_*` or browser bundles. The old Resend variables
are unused. Notifications respect user opt-out; verification and invitation delivery are
explicit transactional email flows.

With `SMTP_SECURE=true`, TLS starts immediately (normally port 465). With
`SMTP_SECURE=false`, STARTTLS is required (normally port 587); certificate validation
stays enabled. Host/user/password/from-email are required when email is enabled.
Reply-to is optional and the sender name defaults to Dirrio. SMTP errors are sanitized.
Task delivery state prevents ordinary repeats; deterministic Message-IDs assist recipient
deduplication, but SMTP cannot guarantee exactly-once delivery after an uncertain response.
See the official [SMTP transport](https://nodemailer.com/smtp) and
[message configuration](https://nodemailer.com/message) references.

Deploy the Convex schema/functions and API/worker/web together, without resetting data.
Allow a 200 MiB upload body in the reverse proxy and sufficient memory for two bounded
uploads; ordinary JSON requests remain capped at 6 MiB. Set `SITE_URL` to the web origin
and `WEB_ORIGINS` to the exact allowed origins. Production web/API origins must use HTTPS
and share a site (for example app.dirrio.com and api.dirrio.com), or use a same-origin
proxy, so SameSite viewer cookies work without third-party-cookie exceptions. Preserve
Range/Content-Range headers and prevent caching of public sharing routes. The API streams
ranges from private storage rather than redirecting the recipient to a bearer file URL.
See [Convex file serving](https://docs.convex.dev/file-storage/serve-files) and
[storage bandwidth/range behavior](https://docs.convex.dev/production/integrations/log-streams).

Automated verification passes: **404 tests** (134 backend, 139 web, 43 API, 88 shared),
plus typecheck, lint, build and diff whitespace checks. The [acceptance report](collaboration-acceptance-report.md)
records the real two-account onboarding, removal/reinvitation, editing conflict/recovery,
newly rendered video/audio, signed-out playback, range, download, expiry and revocation checks.
SMTP accepted verification and invitation messages; inbox placement remains independently unverified.
Production deployment and cross-browser/device coverage remain release checks. No payments,
generation-provider requests or data resets were performed.
