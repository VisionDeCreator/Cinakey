# Polar payment integration

Implemented October 27, 2026. **Disabled by default.** Official `@polar-sh/sdk` 1.0.2, pinned to its `2026-10` API surface. No Polar organization, product, token, webhook endpoint, checkout or live transaction was created during implementation. Tests use SDK mocks and locally signed webhook fixtures.

## Included behavior

- [x] Workspace-bound Polar team customers using the workspace ID as `external_id`. The verified workspace owner is a Polar owner member; team customer email is omitted to support the same person owning multiple workspaces. Checkout uses the resolved customer ID.
- [x] Owner-only hosted subscription checkout, manual usage top-ups, seat changes and customer portal access. Admins can inspect billing; Creators/Reviewers cannot.
- [x] $29/month including the owner; $10 for each additional Admin/Creator seat. Reviewers are free. Invitations do not purchase seats; accepting a paid role or promoting a Reviewer requires an available paid seat.
- [x] Immediate invoiced increases and next-period decreases. Existing members must fit the requested quantity. Subscription changes alone do not increase locally confirmed paid capacity.
- [x] $5 included usage once per successfully paid monthly period, shared by the workspace. No per-seat allowance, rollover or extra allowance on prorations.
- [x] $10/$25/$50 manual top-ups, separately tracked as non-expiring purchased usage. No auto-recharge or second metered usage bill.
- [x] Included funds are reserved before purchased funds. Unused old-period allowance expires even if it returns from an outstanding job after the period ends. Existing authorized jobs can still settle/refund after access loss.
- [x] Raw-body SDK signature verification at `POST /webhooks/polar`, with timestamp verification, durable event admission, delivery-ID deduplication and worker processing. The return URL grants nothing.
- [x] Authoritative order/subscription fetches, immutable invoice-period attribution, receipt-confirmed proration seat capacity and cumulative refund processing. A delayed old invoice cannot extend paid access into a newer unpaid cycle.
- [x] Retry-safe grants by order/period; one top-up checkout cannot fund multiple orders. Unknown checkout POST outcomes are reconciled instead of blindly creating another checkout.
- [x] Period-end cancellation and seven-day overdue grace reflected in generation/seat admission. Production data and stored downloads are retained.
- [x] Partial/full refunds remove available funds from the originating pool once. Used/held funds or subscription refunds pause new generation for operator reconciliation instead of silently inventing a negative balance.
- [x] Disabled state, sandbox label, seat quantity, allowance/purchased balances, subscription/invoice portal, resume checkout and refresh controls on the dedicated Billing page.
- [x] Sandbox/production binding isolation, startup deployment-mode checks, and a guard against sandbox payments funding live providers.

## Seven day workspace trial

Set `WORKSPACE_TRIAL_ENABLED=true` in the API/worker and Convex environments to enroll verified owners with no prior trial or subscription on the selected workspace. The flag is off by default. Existing unpaid verified owners are intentionally eligible for the launch cohort; existing paid subscriptions and internal workspaces are excluded. Creating the first project, series or Genjutsu session atomically starts exactly 168 hours; signing up does not. Confirmation copy explains that generation is purchased separately and subscription conversion is explicit.

One owner creator seat is included during the trial; additional creators require a paid subscription. Trial top-ups create a billing identity without a subscription and grant no monthly included usage. After expiry, remaining purchased funds unlock standalone projects and transformation sessions, script editing, image/video reference uploads and binding, generation settings and video generation. Timeline editing, staging, series management, collaboration, publication and new top-ups still require a subscription. If the purchased balance reaches zero (including fully reserved funds), preparation and generation stop; existing work remains readable/exportable. Residual reservations use purchased funding pools only. Disabling enrollment preserves started trials.

The launch rate card applies supplier cost plus 20% to metered AI usage. Top-ups still fund their face value in retail USD. See [generation pricing](generation-pricing.md) and [trial implementation](workspace-trial-implementation-plan.md).

## Trial disclosures and reminders

The landing page describes the seven-day start trigger, one creator seat, separately purchased generation credits (USD balance, $10 minimum plus tax), no subscription card requirement, no automatic conversion, and the paid plan's separate monthly allowance. It explains the credit-funded preparation workflow after expiry and distinguishes it from subscription-only production tools and further top-ups. Existing work remains viewable, downloadable and exportable even at zero balance.

Projects and media are retained indefinitely for now, including after trial expiry, unless the user deletes them. There is no trial-expiry deletion job. Any future retention policy requires a separate product decision and advance notice; do not imply that purchased credits expire with the trial.

The app shows a dismissible reminder with the exact localized expiry time and a workspace-scoped billing link for owners. Dismissals are remembered per account, workspace and trial period across reloads (and synchronized across tabs). A compact status remains visible after dismissal. Active-trial reminders return after 24 hours; within the final 48 hours they return after 12 hours. Entering the final-48-hour stage and expiry each show a fresh notice regardless of an earlier dismissal. Expired notices return after 24 hours and explain the remaining-credit and retention policies. Successful subscription conversion removes trial notices; closing a notice does not change access permissions.

## Billing page

Open **Billing** in the sidebar, account menu or USD balance display. Settings also links there. `/billing` shows the active workspace; `/billing/:billingWorkspaceId` opens a specific workspace after verifying membership. Workspace switching stays on Billing. Checkout and portal returns are scoped to the original workspace, and inaccessible return links do not silently show a different workspace’s finances.

- **Subscription:** status, current period, cancellation and pending seat notices, paid/occupied seats, the $29 + $10/seat plan and monthly $5 included allowance. Owners can subscribe, resume an interrupted checkout, refresh payment state and change seat quantity. Invalid seat counts cannot be submitted.
- **Usage balance:** separate included and purchased amounts, with $10/$25/$50 owner top-ups during an active trial or paid subscription. All payment actions remain unavailable while Polar is disabled; financial history remains visible.
- **Invoices and payment methods:** owners open a short-lived authenticated Polar portal to access invoices/receipts, billing details, payment methods and subscription cancellation/resumption. Dirrio does not store cards or expose portal URLs to other members. Recent 20 recorded orders display pre-tax amounts and refunds; older history and invoice totals are in the portal.
- **Members and seats:** reuse the existing team controls for invitations, roles, removal, production assignments and invitation delivery/resend/revocation. Invitations do not reserve seats. Removing members does not reduce paid capacity automatically; owners schedule the paid quantity reduction separately. Existing billing-linked ownership-transfer restrictions still apply.
- **Spending:** workspace monthly caps, project/series/episode lifetime caps, reserved/spent totals and latest 100 balance ledger entries. Ledger entries are not invoices.

Admins can inspect billing and manage team/budgets, but cannot purchase, change subscriptions/seats or access the owner portal. Creators/Reviewers see an explanatory access screen and make no financial queries. Backend authorization remains authoritative. Billing drafts/notices reset when the workspace changes; checkout returns never grant funds.

## Environment configuration

Empty placeholders were added to the ignored root `.env` and tracked `.env.example`. Preserve existing secrets. API and worker load the root environment. Never put these secrets in `VITE_*`, client code, Git or Convex environment variables.

```dotenv
POLAR_PAYMENTS_ENABLED=false
SUBSCRIPTION_PAYWALL_ENABLED=false
POLAR_ENVIRONMENT=sandbox
POLAR_ACCESS_TOKEN=
POLAR_WEBHOOK_SECRET=
POLAR_WORKSPACE_PRODUCT_ID=
POLAR_TOPUP_10_PRODUCT_ID=
POLAR_TOPUP_25_PRODUCT_ID=
POLAR_TOPUP_50_PRODUCT_ID=
```

`POLAR_ACCESS_TOKEN` is an organization access token from the intended Dirrio organization. `POLAR_WEBHOOK_SECRET` is the endpoint signing secret supplied by Polar. No separate private/public key pair is needed for this integration. Use scopes for customers read/write, products read, checkouts read/write, subscriptions read/write, orders read and customer sessions write. Product creation, refunds, payouts and organization administration do not need write permissions in this application.

The existing `SITE_URL` is the web origin; `WEB_ORIGINS` controls API CORS. Production activation requires an HTTPS `SITE_URL`. Both SDK API calls and webhook verification fail closed when configuration is incomplete.

Convex also needs the matching **non-secret** deployment mode:

```sh
bunx convex env set POLAR_ENVIRONMENT sandbox
bunx convex env set SUBSCRIPTION_PAYWALL_ENABLED false
```

Run that command from `packages/backend` against the intended deployment. Match `SUBSCRIPTION_PAYWALL_ENABLED` between Convex and API/worker. The startup handshake checks `payments:deploymentEnvironment`. Runtime mock generation has been removed; sandbox deployments can serve Admin and payment APIs, while live provider requests remain blocked because test balances must not fund live generation. Use isolated automated fixtures for sandbox payment tests.

Use separate Convex deployments for sandbox and production. A workspace bound to sandbox billing cannot be reused for production billing; sandbox balances are not converted into real money. Changing environment strings on existing records is not a supported activation procedure.

## Polar dashboard setup

Create four products in the intended **sandbox** organization first:

| Environment variable         | Product                        | Pricing                                                                                                                             |
| ---------------------------- | ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| `POLAR_WORKSPACE_PRODUCT_ID` | Monthly workspace subscription | USD, monthly interval count 1; graduated seat pricing: seat 1 = 2,900 cents; seats 2 onward = 1,000 cents each, no upper tier bound |
| `POLAR_TOPUP_10_PRODUCT_ID`  | One-time usage top-up          | USD fixed price, 1,000 cents                                                                                                        |
| `POLAR_TOPUP_25_PRODUCT_ID`  | One-time usage top-up          | USD fixed price, 2,500 cents                                                                                                        |
| `POLAR_TOPUP_50_PRODUCT_ID`  | One-time usage top-up          | USD fixed price, 5,000 cents                                                                                                        |

Set explicit **exclusive tax** on each price, exactly one active price per product, and no trials or discounts for this initial integration. Checkout checks the configured product's price shape before proceeding. Do not attach Polar usage-credit benefits, usage meters or another monthly allowance: Dirrio's ledger owns usage funding. Dirrio owns application membership and assignments; Polar member/seat roles never grant application access.

Configure the customer portal for payment methods, invoices and cancellation. Keep product switching, alternate price plans, seat changes and team/member administration disabled there where configurable; Dirrio exposes the intended seat policies. Any external subscription change still goes through local paid-capacity checks and cannot bypass Dirrio membership. Portal-issued seat/member benefits are not consumed by this application.

Register the API URL `https://<api-host>/webhooks/polar`, using the matching API version. Subscribe to `order.created`, `order.updated`, `order.paid`, `order.refunded`, and subscription lifecycle events (created, updated, active, canceled, uncanceled, past_due, revoked, paused/resumed and cycled where offered). `subscription.cycled` never directly grants allowance. Store the displayed endpoint secret in the root environment. Preserve the raw request body through the proxy; do not log signatures, authorization, payloads, checkout URLs or portal sessions.

The webhook returns 202 only after durable admission; database failures return 503 for retry. The Bun worker must run to fetch current Polar records and apply them. Monitor failed `payments:processEvent` tasks and Polar webhook delivery failures. After correcting a failure, redelivery requeues an unprocessed failed event without duplicating pending/running work. The API's receipt path does not perform external reconciliation before acknowledging delivery.

## Activation checklist

- [ ] Deploy schema/functions, API, worker and web together; keep payments disabled initially.
- [ ] Create the sandbox products/token/webhook and fill the root variables.
- [ ] Set Convex's non-secret environment mode and mock-provider flag to match the API/worker.
- [ ] Set `POLAR_PAYMENTS_ENABLED=true` in sandbox and restart API/worker. Check Settings and the startup handshake.
- [ ] Complete actual sandbox checkout → webhook → worker → balance qualification, including a top-up, renewal, seat increase/decrease, failed payment, cancellation and refunds. Automated fixtures are not an account-level Polar sandbox qualification.
- [ ] Confirm checkout/invoice totals: $29 for one seat, $39 for two and $49 for three, plus tax. Only one $5 allowance per workspace period.
- [ ] Verify two workspaces owned by the same email create distinct team customers and separate balances/invoices.
- [ ] Confirm real portal settings and any Polar team/member behavior do not bypass the chosen application billing policies. In particular prove pending decreases and failed seat upgrades in the actual sandbox account.
- [ ] Verify product/seller approval for Dirrio's actual functionality and finish the provider rate card before collecting real customer money.
- [ ] Create separate production products/token/webhook and use a separate production Convex deployment. Set `POLAR_ENVIRONMENT=production` consistently, disable development funding/mock providers, configure HTTPS and repeat the deployment checks before live activation.

No production migration, credit conversion or compatibility billing layer is introduced.

## Recovery and current boundaries

**Unknown checkout:** keep the original request ID and use Resume checkout. It can recover a created checkout from Polar metadata without another POST. If no unique match is found, reconcile in Polar before abandoning the local intent. A pending intent blocks another same-kind checkout until its expiry. Refresh billing can recover paid orders even if the first webhook was missed. It reads the latest 100 orders; durable events handle older history. For a proration whose signed paid receipt was missed, redeliver `order.paid` so capacity can be confirmed without guessing from a mutable subscription snapshot.

**Refund review:** `paymentOrders` records cumulative refunded/reversed amounts; `fundingPools` and reservation allocations preserve provenance. A used-funds/subscription refund leaves `paymentWorkspaces.reviewReason` set. Inspect the provider order and outstanding holds, record the recovery/write-off decision, and only then resolve the review in the Admin Billing workspace page with a meaningful reason. `adminBilling:resolveReview` requires billing write access, a consistent ledger, terminal refund intents, and confirmed order accounting for successful refunds. The former internal `payments:clearReview` shortcut has been removed. Automatic debt collection and a dispute-management UI are outside this base integration. Order refunds/revocations received from Polar still take effect.

**Ownership/deletion:** normal ownership transfer is blocked once billing setup starts (a checkout intent or linked Polar customer), pending a supported billing-ownership transfer that revokes the previous owner's portal access. Account deletion is blocked while a subscription remains active, including scheduled cancellation before its effective end. Canceling a subscription does not automatically delete production data or refund purchased usage.

**Rollout/access:** timeline, staging, shared resources, publication and collaboration enforce full production access server-side. Scripts, standalone projects, transformation sessions, basic generation settings and image/video references use a separate generation-preparation capability after the trial while purchased funds remain. Unpaid workspaces without qualifying purchased funds, review-paused workspaces and over-seat workspaces remain restricted even while checkout is disabled. Existing history, saved downloads, cleanup and local MP4 exports remain available; the UI pauses autosaves and retains local drafts until access returns.

`SUBSCRIPTION_PAYWALL_ENABLED=false` keeps unbound development/beta workspaces usable. Leave this and `POLAR_PAYMENTS_ENABLED=false` until Polar is configured and qualified. To require subscriptions for unbound workspaces later, set `SUBSCRIPTION_PAYWALL_ENABLED=true` in both the root environment and the intended Convex deployment, then restart the services. This rollout flag does not activate checkout. Configure and qualify checkout before enforcing it for users.

Upload URLs are project-scoped. Convex signed upload URLs already issued cannot be revoked immediately; they may accept bytes until expiry, but attachment and publication are checked again and rejected after subscription access ends. Existing storage/export limits remain unchanged; commercial storage/egress allowances are a separate product decision.

**Configuration shutdown:** setting `POLAR_PAYMENTS_ENABLED=false` stops checkout/portal/webhook admission. It does not cancel subscriptions, refund orders or erase previously confirmed entitlements. Re-enable and redeliver missed events before relying on fresh local billing state.

## Validation

Actual sandbox checkout, top-up and seat acceptance results, cleanup, and the checks skipped at the user’s request are recorded in [Sandbox acceptance](polar-sandbox-acceptance-report.md). This is not a complete production qualification.

The full suite passes **475 tests** (161 backend, 162 web, 64 API, 88 shared), plus typecheck, lint and build. The existing large-bundle advisory remains. Frontend build output contains no Polar token/secret configuration.

Automated coverage includes Owner/Admin/Creator boundaries; checkout replay and unknown outcomes; actual locally generated Standard Webhooks signatures, tampering and stale timestamps; durable replay; paid-order funding; no funds from unpaid orders/return URLs; allowance expiry and in-flight refunds; seat increases/decreases; delayed mutable snapshots; grace; cumulative refunds and account-deletion safeguards. No external Polar or paid provider request is permitted by the test harness.

Official references checked during implementation: [TypeScript SDK](https://github.com/polarsource/polar/tree/main/sdk/typescript), [organization tokens](https://polar.sh/docs/integrate/oat), [seat pricing](https://polar.sh/docs/features/seat-based-pricing), [proration](https://polar.sh/docs/features/subscriptions/proration), [signed webhooks](https://polar.sh/docs/integrate/webhooks/delivery), [paid orders](https://polar.sh/docs/api-reference/webhooks/order.paid), [refunds](https://polar.sh/docs/features/refunds), and [customer portal sessions](https://polar.sh/docs/api-reference/2026-10/customer-sessions/create-customer-session).
