# USD accounting development integration

Status: implemented locally against a fresh development schema. Payments remain
deferred. This is not a finalized retail rate card or launch qualification.

## Amounts and funding

All stored customer amounts are non-negative integer micro-USD unless they are
signed ledger deltas. One USD is 1,000,000 micro-USD. Dollar inputs parse decimal
strings exactly; fractional usage rounds up once to micro-USD. Unsafe integers,
negative amounts and excess decimal precision are rejected.

`billingAccounts` contains available, reserved, settled spending, funding and a
monotonic sequence per workspace. `usageLedger` is authoritative. Each reserve,
settlement and release updates the account and `spendTotals` atomically. Reads and
cap enforcement use indexed totals rather than full ledger scans. The invariant is:

`funded = available + reserved + spent`

Funding tooling is development/staff-only. Identified funding requests are
idempotent and conflicting retries are rejected; the development UI preserves the
request identity until acknowledgement. It grants the selected workspace in the
generation test page, and personal workspaces for staff email grants. There is no
payment webhook funding, subscription allowance renewal or purchased/promotional
funds expiry policy implemented yet.

The $5 one-time development fixture is enabled only by `USE_MOCK_ADAPTERS=true`
or `ALLOW_DEV_USD=true` in Convex. It is not the $5 allowance associated with a
paid subscription, which awaits payment integration. Without these flags, creating
a workspace does not fund it.

## Prices and quotes

The shared `dev-usd-v1` card is a provisional development fixture:

| Operation    | 720p per second | 1080p per second |
| ------------ | --------------: | ---------------: |
| Seedance 2.5 |           $0.34 |            $0.84 |
| Remix Lite   |           $0.15 |            $0.30 |

The development token rate is $0.002 per 1,000 total tokens. These are not verified
provider costs or published retail prices. D1 remains pending provider cost and
balance checks; the accepted target is 20% contribution margin on API usage,
including applicable variable fees, rather than a 20% markup.

`generation.quote` authorizes a project/member and stores a ten-minute quote with
model, operation, duration, resolution, version, unit price and maximum charge.
`generation.startGeneration` accepts a quote ID, or obtains a fresh server quote
for an immediate start. Customer generation controls send their displayed maximum;
the transformation analysis request also carries its displayed analysis maximum.
A higher quote requires reviewing the new price. The workspace and transformation
orchestrators forward this bound. Changed billable inputs, cross-user/project
quotes, expiry and reuse are rejected atomically before reservation/dispatch.
An acknowledged generation request can replay without a second authorization or
charge, including after quote expiry. Prompt/media validation is independent of
the billable quote fields.

Video workers settle from the job's saved price snapshot, never the current
adapter rate. Actual usage cannot charge beyond the authorized maximum; unused
funds are released. Direct internal text jobs snapshot the development price at
reservation. Analysis/staging settle reported total tokens using the saved job
unit price; entity autofill currently has a fixed bounded operation charge. Separate
input/output/cache prices and verified provider-cost records remain D1 work.
Missing analysis/staging usage retains the hold with `billingNeedsReview` instead
of inventing a charge. An operator can later settle the text job using confirmed
usage through `textJobs.settleChatJob`; this clears the review flag once.

Real provider key access is blocked unless `ALLOW_DEVELOPMENT_PRICES=true` is
explicitly set in the API/worker environment. This is an opt-in for authorized
development testing, not a live pricing approval. No paid calls were used to
validate this integration.

## Budgets and permissions

Workspace caps cover the UTC calendar month of reservation. Series and
project/episode caps cover lifetime usage. Both settled spending and outstanding
holds count. Series and month attribution are pinned on the reserve and copied
into settlement/refund entries; later moves and month changes do not rewrite them.
Lowering a cap does not cancel existing jobs. Zero blocks new usage; blank removes
a cap. Subscription and seat fees are outside production budgets.

Owners and Admins edit caps and see wallet/series/workspace reports. Assigned
Creators can see project usage without wallet access; insufficient-funds errors
omit the workspace balance. Membership is checked again
at admission; workers can settle previously authorized jobs after removal.
Settings and Studio display dollars, and refresh financial queries as other
members create and settle jobs.

## Audit, recovery and remaining work

Internal-only `billing.audit` reconstructs account/scope totals from the ordered
ledger, checking reservations, release bounds, attribution and balance invariants.
`billing.rebuildTotals` repairs aggregates in one transaction only when the
operator's audited `expectedSequence` still matches. It refuses malformed
accounting records. This maintenance path scans workspace history; it should be
paginated before very large workspaces. It does not convert legacy balances.

- [x] USD fields, helpers, endpoints, dollar displays and exact budget inputs.
- [x] Atomic indexed account/scope totals, holds, settlement and releases.
- [x] Stored video quotes, versioned snapshots and accepted-maximum checks.
- [x] Reservation month/series pinning and role-scoped reporting.
- [x] Ledger audit and guarded aggregate rebuild.
- [x] Tests for expiry, replay, attribution, concurrency and monetary precision.
- [ ] Final D1 rates and separate verified provider-cost records.
- [x] Polar purchased/included funding pools, expiring recurring allowances and durable payment events; see [activation guide](polar-payments.md).
- [ ] Genjutsu session rollups, member/operation/date filters and paginated activity.
- [ ] Automatic provider-usage reconciliation and an operator review UI.
- [ ] Two-browser acceptance and fresh remote deployment qualification.

The old credit module/table has been replaced directly. No conversion tools,
production migrations, dual ledgers or old billing compatibility were added. No remote database reset or credit-conversion work was performed. Polar payment funding is now implemented behind disabled configuration; see [activation and qualification](polar-payments.md).
