# Waitlist approval

The landing form posts email, optional name/intended use, and interface locale to `POST /early-access`. Submission validates and normalizes the address, applies per-client rate limits and a honeypot, and deduplicates without revealing membership. Duplicate submissions never reset an administrator’s decision.

## Administration

Accounts → Waitlist displays global counts, newest-first pages, exact normalized email search, and decision filters. Registration is a separate conversion state: an approved request can be registered, and a pending or rejected request can become registered while open registration is enabled. Original review decisions are retained. Refresh reloads counts and the current page after external changes.

Platform administrators have `waitlist.read` and `waitlist.manage`. Other roles receive neither permission by default. Approval, rejection and returning to pending accept an optional note of up to 2000 characters, with no minimum length. Empty notes are omitted from the stored decision and audit entry; actor, timestamp and before/after states are still recorded. Resending an approval email also accepts an optional note of up to 2000 characters. Reviews have revision checks and actor/request deduplication, and append an audit event with the previous and next decision. Reviewer details and the latest reason are shown on the request; the audit log retains the full history.

Approve, reject, and return-to-pending affect unregistered applicants. An existing account cannot be rejected or returned to pending; restrict it through Support’s existing suspension controls instead. Workspace invitations never substitute for platform approval.

## Access and cutover

Email OTP and verified Google authentication share `verifiedEmailUser`. Existing accounts return through the existing-user branch and retain their IDs, staff roles, memberships, ownership, balances, and sessions. No user migration, replacement, or blanket table update is needed. Existing suspension checks remain in effect.

When approval is required, new accounts require an approved request for the exact normalized verified email. Approval is checked in the account-creation transaction, including when consuming an OTP issued before a review decision. Account creation and registration tracking commit atomically. Approval links are ordinary sign-up links, not bearer credentials. Google still requires a verified email, and the same existing identity-linking safeguards apply.

## Email delivery

Approval commits independently of email delivery and enqueues a durable `earlyAccess:sendApproval` task. The API worker uses existing server-side SMTP settings (`EMAIL_NOTIFICATIONS_ENABLED`, `SMTP_*`) and `SITE_URL` for the sign-up URL. Keep the worker running. The request’s captured language selects one of six approval templates; legacy requests default to English.

Delivery is queued, sent (SMTP accepted), or failed. Worker retries and an audited Admin resend are supported. Generation checks ignore obsolete delivery results. A stable Message-ID helps identify repeated attempts, but SMTP does not guarantee exactly-once delivery or inbox placement. Failed mail never withdraws approval; an approved applicant can sign up directly with the approved email.

Deploy backend schema/functions, API/worker, and frontends together. Existing pending requests remain valid. The count query currently scans waitlist records; introduce maintained aggregate counters before the list approaches backend query-read limits.

## Acceptance

See `docs/evidence/waitlist-approval/results.json` and the adjacent screenshots. Browser acceptance uses a clearly marked synthetic development applicant. OTP mail is captured by a temporary isolated QA API; normal worker approval messages are recorded as accepted by SMTP. No real applicant decisions were changed. Interactive Google OAuth is covered by callback tests rather than a live third-party login.

## Registration mode

The **Require waitlist approval** switch at the top of Admin → Waitlist persists the platform registration policy. Missing settings default to On. Only platform administrators receive `waitlist.configure`; reading the page or reviewing requests does not itself grant configuration access. Each change requires a reason, explicit confirmation, a fresh settings revision, an idempotency key, and an audit event (`waitlist.configure`). Canceling confirmation does not persist the draft.

- **On:** new verified-email/Google accounts need approval. Existing accounts and staff retain access.
- **Off:** anyone with a verified email can register, including applicants previously pending or rejected, or people with no waitlist request. Decisions are retained; conversion is tracked when a request exists.
- Turning On again restricts subsequent new registrations. Accounts created while Off remain ordinary existing accounts. Suspensions, workspace permissions, subscriptions and billing controls remain enforced.

Authentication reads the setting inside the account-creation transaction, so an OTP issued while Off cannot bypass approval after On is restored. No deployment is needed to change modes. `GET /registration-policy` exposes only the current boolean, has no-store headers, and fails closed on backend errors. Public pages refresh the display on mount, focus and every 15 seconds. Display state never authorizes account creation.

When Off, public calls to action lead directly to sign-up and the waitlist form/manual-approval copy is replaced by open-registration content. Sign-in/sign-up hides the approval-required note. Existing waitlist records remain reviewable in both modes.

Browser mode acceptance evidence is in `docs/evidence/registration-toggle/`. Tests temporarily opened the development deployment, admitted one synthetic rejected applicant, restored On, verified that account could sign in, and denied a fresh applicant. The final saved setting is **On**. One additional clearly named synthetic request/account remains in development; no real applicant decisions were changed.
