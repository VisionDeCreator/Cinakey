# Phase 1 implementation readiness

> Pricing update — October 28, 2026: the current card uses supplier cost plus configurable 5% markup, including verified DeepSeek off-peak periods. This supersedes earlier 20% margin and fee-allocation decisions. See [generation pricing](generation-pricing.md) for settlement rules and remaining qualification. Earlier pricing notes below are historical; D2 remains nonblocking.

Initial assessment date: October 26, 2026. At assessment time, no application code, schema,
payment products, or live billing configuration changed. No paid generation was run.

Related: [roadmap](product-roadmap.md), [implementation plan](phase-1-implementation-plan.md).

## Subsequent payment implementation

Polar is now selected and the disabled-by-default payment base is implemented. See
[setup and qualification](polar-payments.md). The original assessment below is historical;
account-level sandbox proof, product/seller eligibility and final provider rates still
need confirmation before live activation.

## Subsequent product implementation

The user deferred payment-provider work and prioritized product implementation.
The workspace team/access foundation, global workspace selection, scoped production
creation/listing, ownership transfer, and account-scoped drafts are now implemented
in the working tree; see
[implementation progress](phase-1-implementation-plan.md#product-implementation-progress).
The research below remains evidence for later pricing/payment work, not a blocker
on continued product development. No live deployment or payment setup was performed.

## Readiness verdict

**Ready to begin internal RBAC and USD foundation implementation. Not ready to
publish a final rate card or enable live Polar checkout.** The selected $29 workspace,
$15 extra creator seat, $5 monthly workspace allowance, and 20% API margin remain
the commercial targets. Development credit replacement needs no migration support.

| Gate                      | Evidence/status                                                                    | Blocks                                                  |
| ------------------------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------- |
| Commercial choices        | Accepted in plan                                                                   | None for foundation work                                |
| Sume rates                | Public page plus authenticated read-only model catalog checked                     | Final quotes still need operation-specific confirmation |
| Remix charging basis      | Source-only versus source-plus-output wording conflicts                            | Final Genjutsu retail rate                              |
| DeepSeek billing          | Current Flash rates checked; code lacks complete cost accounting                   | Final analysis/staging quotes and settlement            |
| Polar technical fit       | Documented seat tiers, immediate paid upgrades, next-period changes, grace         | Sandbox proof still required                            |
| Polar product eligibility | Material Genjutsu policy conflict identified                                       | Live Polar launch for full product scope                |
| Seller eligibility        | Likely Hong Kong; organization name Cinakey supplied; account verification pending | Account eligibility and payout verification             |
| Sandbox access            | Opened sandbox; login screen, no authenticated organization available              | Account-level test execution                            |
| Repository baseline       | Typecheck/lint/test/build passed using Turbo cached results                        | Does not prove new feature acceptance                   |

## Pricing evidence and calculation

### Wholesale video rates

Checked public [Sume pricing](https://www.sume.com/sume-api/pricing) and authenticated
GET `/v1/catalog`, then GET `/v1/video-router/models` using the existing server-side
key. Only read operations were performed; credentials are not included here.

| Operation              | 720p USD/second | 1080p USD/second | Evidence caveat                                    |
| ---------------------- | --------------- | ---------------- | -------------------------------------------------- |
| Seedance 2.5           | 0.2312          | 0.5686           | Published prices and catalog agree                 |
| Remix Lite Object Swap | 0.1000          | 0.2000           | Rate agrees; billable-second definition unresolved |

Prior documented 5-second Seedance 720p captures were $1.156 each, consistent with
the current rate. Prior Remix capture of $1 for a roughly 9-second source does not
settle the general charging rule. The router entry is
`higgsfield-genjutsu-light-object-swap`, whereas Cinakey invokes the dedicated
`/v1/sume/remix-lite/object-swap/v1.0` route. Do not assume both routes price identical
billable quantities solely because their per-second rates match.

The router constraints say source plus output seconds; the public table describes
source seconds. Confirm the dedicated route's exact charging basis, rounding,
minimums, and cancellation behavior before setting its retail price. Do not change
the existing 4–15-second Cinakey limit based on the router's wider advertised range.

Extension, first/last-frame generation, and reference-video billing also require
operation-specific quote confirmation. The old two-credits-per-second implementation
is not evidence of dollar cost and cannot be retained as a USD multiplier.

### Payment-fee sensitivity

Using [Polar Starter fees](https://polar.sh/docs/merchant-of-record/fees), an illustrative
international-card top-up has 6.5% variable fee plus $0.50 fixed. Before taxes, FX,
payouts, and other costs, the effective fees are 11.5% on $10, 8.5% on $25, and 7.5%
on $50. Do not charge the fixed payment fee again for every generation. Allocate it
across the purchased usage. Actual fees can be assessed on tax-inclusive collection,
so taxable sales need a separate sensitivity check.

With API cost C and allocated collection fraction f, retail R must satisfy
`R >= C / (0.80 - f)` for 20% contribution margin, before any further variable costs.
This is a margin calculation, not a 20% markup. A $10 international top-up illustration
uses f = 0.115 and denominator 0.685.

| Operation      | Illustrative minimum retail USD/second | Status                                                            |
| -------------- | -------------------------------------- | ----------------------------------------------------------------- |
| Seedance 720p  | 0.337518                               | Before payout/FX/tax-on-fee-base and operational cost adjustments |
| Seedance 1080p | 0.830073                               | Same exclusions                                                   |
| Remix 720p     | 0.145985                               | Per billable second only; billable quantity unresolved            |
| Remix 1080p    | 0.291971                               | Same caveat                                                       |

These are calculated floors, **not an approved or customer-ready rate card**. For
example, $0.34/second would yield a $1.70 five-second 720p quote before the excluded
costs; it must not be represented as guaranteeing the final margin. Select one
published retail schedule from a documented payment/cost profile, rather than changing
generation prices based on individual customers' cards. Measure realized margin and
review future price versions as evidence accumulates. Keep old accepted quotes locked.

Separate subscription economics from generation margin. The $5 allowance is funded
by subscription revenue and is not a purchased $5 top-up. Avoid allocating the same
subscription collection fee both to the full subscription and to allowance redemption.
Never rely on unused prepaid funds to justify the target margin.

### DeepSeek analysis and staging

The current official [Flash rate table](https://api-docs.deepseek.com/quick_start/pricing/)
lists peak costs per million tokens: $0.006 cached input, $0.30 uncached input, $1.20
output; off-peak is half. Use peak assumptions for maximum reservations unless the
provider guarantees off-peak pricing for that submission; settle with actual applicable
usage and the accepted retail price version.

Code discovery:

- Genjutsu requests `deepseek-flash`; staging uses the `completeChat` default
  `deepseek-chat`. Verify/update the staging model explicitly during implementation;
  do not assume a legacy alias has Flash pricing.
- Shared chat result typing exposes prompt/completion/total tokens but not explicit
  cache-hit/miss details. Staging aggregates total tokens; transformation analysis
  currently converts total tokens to credits.
- Monetary costing needs separate input/cache/output counts and bounds on output,
  vision inputs, repair calls, and missing usage. Missing usage must remain pending
  reconciliation rather than silently inventing an actual token charge.
- Snapshot the model, rate version, and reserved maximum; never start an unbudgeted
  repair or later rendering stage. Provider rate changes cannot raise an accepted cap.

## Polar validation

### Material eligibility blocker

[Polar's acceptable-use policy](https://polar.sh/legal/acceptable-use-policy) lists AI
generation tools for closer review and prohibits generation enabling face swaps or
deepfakes. Cinakey's current character-recasting/real-person transformation scope may
conflict. General SaaS support and a successful sandbox purchase would not establish
approval for that scope. Preserve the selected provider, but require an explicit scope
resolution before live checkout; do not quietly remove Genjutsu or call it approved.

- [x] Record user-supplied likely jurisdiction (Hong Kong) and Polar organization name (Cinakey).
- [x] Check published payout coverage: Hong Kong is listed.
- [ ] Confirm final incorporation jurisdiction and authenticate the intended Cinakey
      organization; verify sandbox and live organization identities separately.
- [ ] Obtain Polar's determination for Cinakey's actual generation/transformation scope,
      including character recasting and consent-based real-person inputs.
- [ ] If not accepted, decide whether to change product scope or reassess the provider.
      Do not implement both providers in anticipation.

The user identified Hong Kong as the likely incorporation jurisdiction and Cinakey
as the Polar organization name. This is not evidence of completed incorporation,
organization authentication, KYC, or product approval. Hong Kong is listed in Polar’s
[supported payout countries](https://polar.sh/docs/merchant-of-record/supported-countries);
country coverage therefore appears compatible with the proposed setup.

No message or application was submitted to Polar. Business identity/KYC must be
provided by the account owner, not inferred from the user's timezone.

### Documentation fit

| Requirement                                | Documented capability                                 | Implementation consequence                                                    |
| ------------------------------------------ | ----------------------------------------------------- | ----------------------------------------------------------------------------- |
| $29 first creator, $15 subsequent creators | Graduated seat tiers                                  | Prototype first-seat tier then remaining-seat tier; prove exact invoices      |
| Paid mid-period increases                  | `invoice` proration                                   | Do not activate capacity until authoritative payment confirmation             |
| Lower capacity at renewal                  | `next_period` scheduled updates                       | Reconcile pending changes; later updates supersede earlier ones               |
| Seven-day grace                            | Organization benefit-revocation grace supports 7 days | Match Cinakey's own entitlement rules; do not grant unpaid allowance          |
| Prepaid top-ups                            | One-time products/credit benefits                     | Fund Cinakey ledger once; no second metered usage invoice                     |
| Monthly included $5                        | Paid order events                                     | Do not grant from `subscription.cycled`, which can precede successful payment |
| Bun/Elysia API                             | TypeScript SDK                                        | Use SDK directly; Polar's Elysia adapter is deprecated                        |

Sources: [seats](https://polar.sh/docs/features/seat-based-pricing),
[proration](https://polar.sh/docs/features/subscriptions/proration),
[grace](https://polar.sh/docs/features/subscriptions/failed-payments),
[webhook lifecycle](https://polar.sh/docs/integrate/webhooks/events),
[prepaid credits](https://polar.sh/features/credits),
[Elysia adapter status](https://polar.sh/docs/integrate/sdk/adapters/elysia).

Keep Cinakey workspace roles and invitations authoritative. Polar billing-manager/member
roles must not grant Cinakey Admin/payment access. Restrict customer-portal actions so
they cannot bypass Owner-only seat/payment decisions. A customer account must map to a
workspace, not merely the owner's personal user, including multi-workspace ownership.

### Sandbox proof checklist — not executed

Sandbox is isolated and requires its own account/organization. Current browser access
stops at login; there is no configured Polar credential in the root environment.
This is a concrete access blocker, not a passed integration test.

- [ ] Create/use a dedicated authenticated sandbox organization.
- [ ] Verify $29 for one seat, $44 for two, $59 for three, with one pooled allowance.
- [ ] Verify paid upgrade, failed upgrade, scheduled decrease, and reassignment.
- [ ] Exercise renewal success/failure, seven-day grace, cancellation, recovery.
- [ ] Purchase $10/$25/$50 test top-ups and process partial/full refunds.
- [ ] Deliver duplicate and out-of-order events; grant allowance once per paid period.
- [ ] Verify prorated seat invoices do not refill allowance or reset its expiry.
- [ ] Verify portal actions cannot escape Cinakey's accepted policies.
- [ ] Save non-secret evidence IDs and expected/actual results in this document.

Checkout evidence can precede application integration; end-to-end webhook/ledger proofs
require T8 implementation. Do not mark those complete during preparation.

## Implementation order and handoff

1. **Foundation: T2–T3 and T5.** Membership/schema, permission inventory, monetary
   ledger/quote contracts. Unit tests use fixture prices and mocked payments.
2. **Production integration: T4, T6–T7.** Active workspace UI, every paid path, atomic
   budgets, direct removal of development credit paths. Keep live prices gated.
3. **Collaboration: T9–T10.** Editing leases, saved snapshots, persisted published media.
4. **Review: T11–T13.** Private sessions, comments/approval/delivery, spending views.
5. **Commerce: T8.** Polar SDK, verified raw-body webhook route, product mapping,
   subscription/seat/allowance entitlement handling, sandbox proofs. Provider scope
   acceptance blocks live activation, not internal schema work.
6. **Qualification: T14.** New-feature tests, two-browser acceptance, reconciliation,
   final rate-card validation, customer-visible terms, pilot launch.

No schema reset, deployment, account creation, credentials, or paid products were
performed as part of this readiness check. Use additive product provenance/versioning
where needed, but no old billing compatibility or production migration tools.

### First implementation batch acceptance

- [ ] New workspace has an Owner membership; cross-workspace requests are denied.
- [ ] Creator assignments and inherited series access obey the agreed matrix.
- [ ] USD holds, settlement, release, and funding are idempotent and reconcile.
- [ ] Concurrency cannot exceed available funds or applicable budgets.
- [ ] Fixture prices prove the system without claiming to be published retail rates.
- [ ] No paid provider call or live payment is required to validate the batch.

### Baseline checks

- [x] `bun run typecheck`: passed; cached Turbo results.
- [x] `bun run lint`: passed; cached Turbo results.
- [x] `bun run test`: passed, including secret-check command; cached package results.
- [x] `bun run build`: passed; cached Turbo results.
- [ ] New-feature tests and live sandbox proofs: not implemented/executed yet.

Before changing application code, rerun relevant checks after each batch. The baseline
does not replace browser acceptance or force a full cache-free run for documentation.

### Budget integration verification

The local budget batch now enforces workspace monthly, series lifetime and
project/episode lifetime caps in the reservation transaction for video and text
jobs. Settings exposes Owner/Admin controls; Studio separates project spending
from holds. Reservations pin series and UTC month for later settlement/refund.

Full tests, typecheck, lint, build and `git diff --check` passed after this batch.
There are 105 backend tests and 113 frontend tests. No deployment, remote fixture
reset or paid provider call was performed. The build retains its large-chunk warning.

This earlier budget batch used credits and ledger scans; it is superseded by the USD
integration below. It did not complete launch qualification.

### USD integration verification

Integer micro-USD accounting, dollar displays/inputs, stored ten-minute video quotes,
price snapshots and indexed account/scope totals are now implemented locally. The
legacy credit table/module was replaced directly. An internal ledger audit and guarded
aggregate rebuild are available; missing analysis/staging usage retains its hold for
review. See [USD accounting](usd-accounting.md) for exact scope and development flags.

D1 retail rates remain provisional and D2 conversion remains unnecessary. No remote
reset, deployment, paid call or payment integration was performed. Payment funding,
recurring allowances, purchased/promotional funds policy, advanced reporting and
live multi-browser qualification remain pending.

USD batch checks passed: full `bun run test` (112 backend, 114 web, 33 API and
88 shared tests), `bun run typecheck`, `bun run lint`, `bun run build`, changed-file
Prettier checks and `git diff --check`. The existing Vite large-chunk warning remains.

### Approved development reset — October 27, 2026

The user approved a backup and full development application-data reset after the
credit-era records blocked the required USD schema. The reset was completed on
`dev:sensible-hare-220`, followed by a successful schema/function push with typechecking.
The verified private, git-ignored backup is at
`.convex/backups/usd-reset-2026-10-27/frozen-snapshot.zip`: 2,286 documents across
53 tables and 350 stored files, with ZIP CRC validation and a SHA-256 manifest.
Original storage blobs were retained; application records and authentication data
were cleared. Recovery needs the matching credit-era schema, not a direct import
into the USD schema.

The generation, ledger and account tables were confirmed empty. The deployed quote
estimate returned 1,700,000 micro-USD for the five-second 720p development fixture.
Development auto-funding has been removed. Fund workspaces explicitly through the Admin panel.
The API health endpoint and frontend both responded successfully. No paid provider
requests were made. All backed-up generation jobs were succeeded/refunded.

A startup regression was also corrected: startup validates configured provider keys
without requiring live development-price permission; actual provider requests still
require the pricing opt-in. API tests (33), repository typecheck and lint passed.
