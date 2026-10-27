# Email OTP authentication

Email signup and login share one passwordless flow. Google sign-in remains available. Existing users keep their user IDs, workspace memberships, ownership, balances, subscriptions and billing records. Email verification does not alter roles or grant workspace access.

## Configuration

Use the existing server-only root `.env` values: `EMAIL_NOTIFICATIONS_ENABLED=true`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM_NAME`, `SMTP_FROM_EMAIL`, and optional `SMTP_REPLY_TO`. Nodemailer sends messages from the Bun API; no SMTP secrets belong in Convex or frontend environment files. The API must be running for email login. Disabled/misconfigured SMTP fails closed; Google remains independent of SMTP.

Keep the existing Convex Auth JWT/JWKS and Google OAuth configuration. Google must return a verified email. Its callback URL does not change. Set `WEB_ORIGINS` to the exact frontend origins allowed to call the API and `VITE_API_URL` to the API URL.

`AUTH_TRUSTED_PROXY_IPS` is optional and defaults to empty. Only list exact trusted reverse-proxy socket addresses when the API is behind a proxy that controls `X-Forwarded-For`. Without this setting, rate limiting uses the socket peer and ignores forwarded headers. Include the actual address format seen by the API, including IPv4-mapped IPv6 if applicable. Do not trust arbitrary client-provided headers.

## Behaviour and safeguards

- Six-digit cryptographically random codes, valid for 10 minutes, at most five guesses, single use. Leading zeros are supported.
- Each request receives a separate 256-bit random browser challenge. Verification requires that challenge, the email, and the code. Raw codes and challenges are not stored in Convex; only hashes are stored. The raw challenge is kept in tab-scoped session storage to survive reloads. Codes are never persisted in browser storage or returned by the API.
- Codes are usable only after SMTP accepts delivery. Delivery errors are sanitized. SMTP acceptance cannot guarantee inbox placement; verify sender domain/DKIM/SPF and spam handling before launch.
- A new request supersedes the previous code. Request cooldown is 60 seconds while a challenge exists, with separate atomic limits of five requests/email/hour, ten/email/day, 100/IP/hour and 1,000 globally/hour. These are initial limits to tune with real usage. The frontend also respects server Retry-After.
- Unknown and existing email addresses follow the same request response; new users are created only after successful verification.
- Matching verified email sign-ins reuse the existing user record, including former password users. Ambiguous duplicate email records fail with account-assistance feedback rather than merging ownership.
- Google and OTP resolve to the same unique normalized email identity. An existing Google account pointing to a different user than the matching email fails closed for manual review.
- Password provider, signup fields and password hashes are retired. Existing valid sessions remain valid.
- Expired challenge cleanup runs in the API worker every five minutes. Verification checks expiry even if the worker is offline.

## Existing deployment cutover

Deploy the schema/functions/API/frontend together. Before opening email login, run these **internal development/admin operations** with the deployment CLI; they are not public API routes:

1. Snapshot user IDs, workspace ownership/memberships and billing associations privately. Never reset tables or create replacement users.
2. Run `authOtp:normalizeExistingEmails` with `{ "cursor": null }`, then repeat with the returned cursor until `isDone`. This trims/lowercases email keys in place. Review duplicate normalized addresses manually; never silently merge accounts. A malformed legacy email aborts its batch and needs correction before retrying.
3. Verify real SMTP login for an existing owner and a new account, session refresh, workspace access and billing access. Compare all pre-existing ownership/billing associations against the snapshot.
4. Run `authOtp:retirePasswords` with `{}` repeatedly until `isDone`. This removes only password auth-account records; it retains users, Google accounts and sessions. The password provider is already unavailable after deploying the new auth configuration.
5. Remove temporary QA code/session captures, shut down isolated test servers and keep production payments unchanged.

For subsequent fresh deployments, no cutover data operations are necessary. Run standard repository tests, typecheck, lint and build.

## Development acceptance — 2026-10-27

- [x] Deployed to the existing development Convex deployment; normal local API restarted with the new endpoint.
- [x] Real SMTP accepted messages for an existing sandbox QA owner and a fresh QA mailbox alias. Browser verification completed against the real development backend. The test harness forwarded real Nodemailer messages and captured only these QA codes privately; inbox placement was not independently observed.
- [x] Existing owner reached Billing with the original workspace, invoices, subscription state, included allowance and purchased balance. Pending challenges and authenticated sessions survived reloads. Logout returned to sign-in.
- [x] New-account signup rejected a wrong code without creating a user, then created exactly one verified user and personal workspace with the correct code.
- [x] Compared all six pre-existing user IDs/personal-workspace references, six workspaces, one membership, one payment-workspace record, six billing accounts, eight ledger rows and two funding pools with the pre-change snapshot. Ownership, memberships, billing data and balances were unchanged.
- [x] Normalized existing email keys in place and retired all six password auth-account records. No existing user or workspace was deleted. A second real SMTP/browser login after password retirement confirmed the existing owner still reached Billing.
- [x] Live Google OAuth initialization returned a redirect to `accounts.google.com`. Automated callback tests confirm verified Google profiles reuse the same OTP user and unverified profiles are rejected. A complete interactive Google login was not performed.
- [x] Full automated suite: 495 tests passed (backend 170, API 70, web 167, shared 88). Typecheck, lint, production build and targeted formatting passed.
- [x] Production payments were not enabled or modified; existing Polar sandbox settings remain in place.

Evidence: [existing owner billing access](evidence/email-otp-existing-billing.png).
