# Polar sandbox acceptance — October 27, 2026

Production payments were not enabled. Requests used Polar sandbox and the existing development Convex deployment, isolated QA accounts/workspaces, standard Stripe test cards, and mock AI providers. No real customer payment or paid AI generation was performed. Existing user workspaces and payment records were not used as test fixtures.

The user requested skipping the remaining dashboard-level checks. The results below distinguish completed sandbox checks from tests not qualified end to end.

## Completed

- [x] Validate the configured token against actual sandbox APIs. Initial missing Products/Customers/Checkouts permissions were corrected by the user.
- [x] Correct and validate the four configured sandbox products. The workspace product initially had two active prices and a volume tier; it now has one active graduated USD seat price: first seat $29, additional seats $15. All four products now have explicit exclusive tax.
- [x] Create checkout through Dirrio's authenticated HTTP API, complete the real sandbox hosted subscription checkout, and verify the one-seat $29 charge.
- [x] Verify that creating checkout and returning to the app grant no funds. Refresh billing retrieves the actual paid order and grants exactly $5 included usage.
- [x] Create a $10 usage checkout. A declined test card produces an error and grants no purchased usage. A subsequent successful test payment grants exactly $10 purchased usage.
- [x] Refresh repeatedly and replay signed integration fixtures without duplicating the monthly allowance or top-up.
- [x] Increase to two seats through Dirrio. Before signed paid-invoice processing, local confirmed capacity remains one and a second Creator cannot accept an invitation.
- [x] Build signed local webhook fixtures from the actual QA paid sandbox orders; validate signatures through the webhook-only relay and real API route; admit durable events; claim/process/complete tasks with the same payment service handlers. Confirmed paid capacity becomes two, and the QA Creator can join. **These were integration fixtures signed locally, not actual Polar-origin delivery.**
- [x] Test Creator/Admin/Owner boundaries through authenticated HTTP: Creators cannot read financial summaries; Admins can inspect summaries but cannot purchase, open the owner portal or change seats. Removed members lose financial access.
- [x] Reject reducing seats below occupied capacity. Remove the QA member and schedule a reduction from two seats to one for renewal, without increasing the allowance or changing purchased usage.
- [x] Open the owner-authorized Polar sandbox portal through Dirrio. Inspect the subscription, next $44 invoice and paid order history, including invoice and receipt controls.
- [x] Verify the temporary public relay returns 404 for every application route, rejects unsigned/invalid signatures with 403, and admits a valid signed fixture with 202.
- [x] Revoke the QA subscription and synchronize its canceled state before cleanup. No QA subscription remains scheduled to renew.

Mock-development starter funding is separate from payment allowances: this QA wallet had a $5 development grant, $5 paid-period allowance and $10 purchased usage. The resulting $20 wallet total is not a duplicate subscription grant. Production funding must keep mock/development grants disabled.

## Fixes

- [x] Fail startup when sandbox payments are combined with live AI providers, even if API/worker and Convex otherwise agree. Regression coverage confirms no remote work happens before rejection.
- [x] Discard Polar's appended `customer_session_token` from the app return URL before auth/router initialization. Dirrio issues owner-authorized portal sessions itself and does not consume this return token. Preserve workspace, return marker and unrelated OAuth callbacks.
- [x] Show an explicit notice while extra seats await payment confirmation.
- [x] Hide next-renewal seat scheduling notices on inactive subscriptions.
- [x] Match the development Convex paywall flag to the user's saved root environment, and keep development provider mode on mocks. The normal local API restarts successfully in sandbox mode.

## Not qualified / skipped at user request

- [ ] Actual Polar-origin webhook delivery through the dashboard-configured endpoint. The configured token lacked webhook-management permissions, and the requested temporary endpoint update was not confirmed. Locally signed fixtures do not substitute for this qualification.
- [ ] Portal policy toggles. The actual portal still displayed Change plan. Disable portal plan changes and seat management before public launch; application membership remains controlled by Dirrio.
- [ ] Refund execution. The sandbox API rejected the QA refund request with missing `refunds:write` permission. No refund occurred. This permission is an operator/test permission; the runtime application does not require it to process refund webhooks.
- [ ] Complete renewal, failed-renewal/grace and recovery qualification. A QA billing-period shortening was requested before the user stopped the remaining checks; the subscription was then revoked during cleanup.
- [ ] Successful PDF download. The portal's invoice-generation form was reached, but synthetic address changes were rejected with “State cannot be changed.” Actual invoice/receipt PDF downloads were not verified.

## Cleanup and validation

The second QA member was removed. The QA subscription was canceled. The temporary ngrok tunnel, webhook-only relay and isolated payment worker were stopped. The local API was restarted with the saved root sandbox configuration. No production products, tokens, webhook endpoints or transactions were created or activated.

All **475 automated tests** pass (161 backend, 162 web, 64 API, 88 shared), along with typecheck, lint and the production build. [Billing state after QA cancellation](evidence/polar-sandbox-billing.png).

The application build retains its existing large-chunk advisory. These automated checks and the completed sandbox cases do not establish full production payment readiness.
