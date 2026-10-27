# Collaboration, export and sharing acceptance

Date: October 27, 2026. Environment: development Convex deployment, isolated local API/web servers, two new QA accounts and a signed-out browser origin. Payments and paid generation were excluded. Existing application services and user data were preserved.

## Live acceptance results

- [x] Owner and Creator sign up, verify email and accept a workspace invitation.
- [x] Invitation acceptance switches to the joined workspace after membership refresh.
- [x] An unassigned Creator cannot read the production or access wallet/member administration.
- [x] Owner assignment exposes the production to the Creator.
- [x] Concurrent editors show the holder and enforce read-only controls; Creator cannot force takeover.
- [x] Explicit Owner takeover rejects the displaced writer and preserves its local draft.
- [x] Recovering the draft appends a new saved version with Creator authorship. Three versions retained; recovered tip contains both title clips.
- [x] Restoring the original Owner snapshot appends a fourth version, retains earlier versions and leaves the publication hash unchanged.
- [x] Full-page navigation releases the lock so the other account acquires editing access without takeover.
- [x] Removing the Creator denies project, script, assets, publications and stored download access. The UI leaves the inaccessible workspace without crashing.
- [x] Reinvitation and reassignment restore access through the normal UI.
- [x] Import a real video and render/upload/finalize a browser MP4 export from its saved snapshot.
- [x] Inspect a decoded frame and verify non-silent exported audio; stored download SHA-256 matches immutable publication metadata.
- [x] Later edits do not alter the export's saved-version binding or file hash.
- [x] Signed-out password-protected playback rejects the wrong password and decodes/plays with the correct password.
- [x] Native playback seeking works; video remains available after the publisher's browser tab closes.
- [x] Watch-only explicit download is denied; a separate download-enabled link returns the exact exported bytes.
- [x] Anonymous and cross-link session requests fail with 403; valid prefix/suffix ranges return 206 with matching bytes; invalid ranges return 416; HEAD succeeds.
- [x] Link expiry denies an existing viewer session.
- [x] Revocation denies existing-session media and new-session creation with 403; signed-out UI shows the revoked/expired error.
- [x] All QA share links revoked after testing.

Export fixture: moving test bars and a 440 Hz source tone; 1920×1080 H.264 video, 4.000 seconds; AAC audio, 4.075 seconds including codec padding; 1,936,692 bytes. Decoded audio RMS approximately 0.0875. Browser reported readyState 4 and no media error; native seek reached 2.088 seconds.

Real Nodemailer SMTP accepted both verification messages and the reinvitation. Verification used the codes actually submitted to SMTP. Inbox placement was not independently checked. The invitation service was invoked for the specific QA invitation rather than draining unrelated generation jobs.

## Fixes made during acceptance

- Switch to an accepted workspace only once its membership is available to the workspace provider.
- Canonicalize timeline object keys when comparing saved/exported snapshots; Convex serialization order no longer prevents export.
- Disable timeline insertion/title/inspector actions while read-only and avoid false success notices.
- Serialize editor lease setup/release to avoid StrictMode/retry races; release on page navigation with a keepalive request, and ignore late renewals after leaving.
- Keep structured permission/lease error codes while showing human-readable messages without backend stack traces.

Regression tests cover these fixes. The complete suite passes **404 tests**: 134 backend, 139 web, 43 API and 88 shared. Typecheck, lint and production build pass. Build retains the existing large-chunk advisory.

## Limits and remaining release checks

Upload failure/retry, idempotent finalization, invalid media, storage limits, stale upload attempts and the wider role matrix are covered by automated fixtures. They were not all fault-injected into the live browser session. The browser run used the in-app browser on macOS; cross-browser/device coverage and production HTTPS/proxy/cookie configuration remain deployment checks. No production deployment or payment-provider work was performed.

QA accounts, workspace and media remain clearly labelled for inspection. Private credentials and temporary harness files are gitignored; they are not part of this report or the repository changes.
