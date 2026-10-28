# Cinakey product roadmap

> Pricing update — October 28, 2026: the current card uses supplier cost plus configurable 5% markup, including verified DeepSeek off-peak periods. This supersedes earlier 20% margin and fee-allocation decisions. See [generation pricing](generation-pricing.md) for settlement rules and remaining qualification. Earlier pricing notes below are historical; D2 remains nonblocking.

> Scope update (October 27, 2026): the current MVP is team collaboration, safe editing,
> stored video exports and simple private sharing. Comments, annotations, approvals,
> designated approvers and Reviewer-specific workflows below are deferred. Follow the
> [current implementation strategy](collaboration-sharing-implementation.md) for task
> status, dependencies and acceptance criteria. Polar is now selected and its disabled-by-default integration is implemented;
> see [activation and remaining qualification](polar-payments.md).

Status: direction and core policies accepted; workspace team/access foundation implemented locally.
The remaining Phase 1 work is pending, with Polar integration implemented but activation and account-level qualification pending.
The $5 monthly workspace usage allowance and Polar launch provider are accepted;
rate-card validation and provider eligibility/sandbox checks remain open.
Planning baseline: October 26, 2026. No delivery dates or engineering estimates are committed.

See [Phase 1 implementation plan](phase-1-implementation-plan.md) for tasks,
dependencies, acceptance criteria, accepted decisions, and release gates.

Cinakey is still in development. Replace schemas and billing paths directly; no
production migration, legacy billing compatibility, or balance-preservation tooling
is in scope. Development fixtures can be regenerated during implementation. Saved
creative history and published versioning remain core product features.

## Latest payment batch

Polar checkout, signed durable webhooks, workspace subscriptions/seats, manual USD top-ups,
expiring $5 monthly funding pools and Owner billing controls are implemented behind environment
configuration. No account-level sandbox or live payment has been run. See
[setup, scope and remaining gates](polar-payments.md).

## Latest collaboration batch

- [x] Email verification and transactional invitation delivery via Nodemailer SMTP.
- [x] Timeline editing leases, read-only safeguards, audited takeover and version authorship.
- [x] Immutable stored exports, bounded uploads, download/delete controls and abandoned-upload cleanup.
- [x] Private video links with passwords, expiry, download controls and revocation.
- [x] Direct endpoint permission matrix, including removal of silent cross-workspace staff access.
- [x] Complete development two-account, rendered-video/audio and SMTP submission acceptance; see [results and remaining deployment checks](collaboration-acceptance-report.md).

See [implementation details and limits](collaboration-sharing-implementation.md) and the
[permission audit](collaboration-permissions-audit.md). Payments and review/approval
workflows remain deferred.

## Product direction

Cinakey is a production workspace for small creative teams: from script and visual
planning to finished, client-approved video. The initial audience hypothesis is
freelancers and small studios producing short commercial videos for clients.

Depth means helping teams complete paid projects, manage revisions, control
spending, and repeat successful production workflows. A focused generation
experience supports this direction. One underlying model is an initial constraint,
not a permanent customer promise. Low generation prices alone are not the moat.

Validate the audience and workflow with real client projects before expanding
into a general-purpose professional editing suite.

## Implementation readiness

See [readiness assessment](phase-1-readiness.md) for verified supplier costs, fee
calculations, the implementation sequence, and remaining gates. Internal RBAC/USD
foundation work can start. Final retail rates and live Polar billing remain gated:
Remix billable seconds need clarification, and Polar policy may conflict with
Genjutsu character-recasting/real-person transformations. Sandbox access and seller
eligibility are not yet verified.

## Current foundation

This baseline comes from repository inspection and documentation, not a complete
live product acceptance test. See [workspace model](workspace-model.md),
[series](series.md), [production safety](production-safety.md), and
[provider contract](provider-contract.md).

| Area       | Existing foundation                                                   | Required expansion                                                |
| ---------- | --------------------------------------------------------------------- | ----------------------------------------------------------------- |
| Production | Scripts, references, staging, generation snapshots and history        | Shared access and workflow polish                                 |
| Editing    | Timeline, audio, titles, trimming, source replacement, browser export | Acceptance testing, safe collaborative editing, published outputs |
| Recovery   | Versioned documents, optimistic conflicts, local draft recovery       | Understandable authorship, handoff, restoration                   |
| Series     | Episodes, shared files, versioned resources, explicit adoption        | Financial rollups, series budgets, team assignments               |
| Spending   | Credit ledger, reservations, settlements/refunds, project caps        | USD pricing, financial attribution, hierarchical budgets          |
| Access     | Workspace ownership and staff override                                | Membership, RBAC, resource assignments                            |
| Exports    | Local MP4 download and metadata records                               | Stored immutable media for review and delivery                    |
| Genjutsu   | Separate transformation sessions, analysis/rendering, lineage         | Workspace context and monetary usage reporting                    |

An episode remains a project belonging to a series. Do not introduce a second
episode production or accounting system.

## Priorities and sequencing

- **P0:** Required for trustworthy paid client production and the Phase 1 MVP.
- **P1:** Improves repeat production after the MVP succeeds with pilot teams.
- **P2:** Demand-driven studio scale and advanced capabilities.

Phases are dependency gates, not calendar promises. Independent workstreams can
proceed together once their contracts are settled.

## Phase 0 — Launch readiness and commercial rules

Priority: prerequisite for Phase 1 launch.

- [ ] Verify script → generation → edit → export with representative client videos.
- [ ] Verify recovery, conflicts, version restoration, audio, titles, export consistency.
- [ ] Publish supported browser/media/output limits; current documented envelope is
      five minutes and 1080p.
- [ ] Identify editing gaps that actually block finished deliverables.
- [ ] Define retail USD prices, rounding, failure treatment,
      promotional balances, and storage allowance.
- [ ] Review margin including provider, analysis, storage, delivery, and payment costs.

Dependencies: existing production foundation; commercial decisions D1–D4 in the
Phase 1 plan.

Acceptance criteria:

- [ ] A creator completes, closes, reopens, and exports a representative project.
- [ ] Every paid operation has an understandable estimate and financial outcome.
- [ ] Supported limits and material acceptance gaps are documented.

## Phase 1 — Client-production MVP

Priority: P0. Detailed task IDs are defined in the linked implementation plan.

- [ ] T1: Freeze permission, commercial, and lifecycle contracts.
- [ ] T2–T4: Membership, invitations, RBAC, assignments, active workspace UI.
- [ ] T5–T7: Monetary ledger, all paid operations, hierarchical budgets, direct development USD replacement.
- [ ] T8: Subscription, creator seats, manual prepaid USD top-ups.
- [ ] T9: Single active timeline editor, safe handoff, shared version history.
- [ ] T10: Persist immutable exports tied to saved timeline versions.
- [ ] T11–T12: Private links, timestamped comments, revisions, verified approval, delivery.
- [ ] T13: Spending by workspace, standalone project, series, episode, and Genjutsu.
- [ ] T14: Fresh-setup, authorization/financial qualification, pilot launch.

MVP financial controls: workspace monthly cap, series lifetime cap, project/episode
lifetime cap, and prepaid balance. Pending reservations consume available budget.
Genjutsu initially uses the workspace cap and retains separate session reporting.

MVP roles: Owner, Admin, Creator, Reviewer. Roles determine actions; explicit
project/series assignments determine resource scope. External reviewers are free.
Approver identity is separate from workspace role.

Dependencies: Phase 0 acceptance and commercial rules; task graph in Phase 1 plan.

Acceptance criteria:

- [ ] A small studio invites a collaborator and assigns an episode.
- [ ] It produces within workspace, series, and episode budgets.
- [ ] A client reviews an immutable published version and requests changes.
- [ ] A designated, verified approver approves the revised version.
- [ ] The client downloads the exact approved file when permitted.
- [ ] Access isolation and financial reconciliation pass all release gates.

Explicitly deferred: custom roles, SSO, simultaneous character-level script editing,
multiplayer timeline editing, advanced effects, automatic production agents, client
invoicing, automatic profitability calculations, and server rendering unless browser
acceptance testing establishes it as a blocker.

## Phase 2 — Repeat production and stronger collaboration

Priority: P1. Depends on successful paid pilot production and measured bottlenecks.

- [ ] Project/series templates for defaults, references, titles, and output settings.
- [ ] Approved brand libraries built on existing versioned resources.
- [ ] Assignable feedback and revision tasks; unresolved work before approval.
- [ ] Published-version comparison and change summaries.
- [ ] Member spending limits, budget alerts, CSV reports, spending requests.
- [ ] Optional auto-top-up with an explicit monthly ceiling.
- [ ] Portrait, square, and landscape deliverables with manual reframing.
- [ ] Captions, audio fades/ducking, reusable titles where pilots need them.
- [ ] Persistent proxies/background export if measured performance warrants them.

Acceptance criteria:

- [ ] Teams complete subsequent projects/episodes with less setup and coordination.
- [ ] Resource revisions remain explicit and preserve earlier output provenance.
- [ ] New automation and financial controls remain understandable and bounded.

## Phase 3 — Studio scale and advanced production

Priority: P2. Depends on demonstrated demand from larger studios.

- [ ] Simultaneous script editing and, if justified, collaborative timeline editing.
- [ ] Custom roles, delegated billing, detailed audit exports.
- [ ] Client portals across multiple projects.
- [ ] Advanced budget approvals and profitability reporting using entered revenue
      and external costs.
- [ ] Professional editor interchange and deeper audio/motion capabilities.
- [ ] Larger exports and enterprise controls.
- [ ] Additional generation capabilities where the target workflow requires them.

Acceptance criteria:

- [ ] Larger teams can adopt Cinakey without losing financial oversight, access
      control, or production reliability.
- [ ] Each expansion has validated demand and sustainable operating economics.

## Commercial direction

Accepted pilot model: **$29/month per workspace**, including one Owner creator
seat; **$15/month per additional Creator/Admin**, with free Reviewers. Includes
**25 GB pooled storage** and **100 GB/month delivery** as pilot allowances to validate.
Manual prepaid USD top-ups start at **$10**. Annual plans and auto-top-up are deferred.
Subscriptions pay for production tools, collaboration, review, versioning, and storage/
delivery. Seats do not automatically add usage or storage. Warn before limits and
provide a manual upgrade path without surprise overage charges or silent deletion.

Target **20% contribution margin on API usage**, with subscriptions the primary profit
source. This is margin, not markup: before collection fees, $1 cost requires $1.25
retail. Include attributable API/analysis costs and allocated payment fees in rate-card
checks; account for platform storage/delivery under subscription economics. Keep
provider costs internal and distinct from retail charges. D1's actual rates are pending
cost checks. D2 conversion remains deferred/nonblocking; no production balance migration
is required for a development-only product.

Show retail USD estimates, lock accepted 10-minute quotes, reserve the maximum, settle
actual authorized usage, and release unused funds. Purchased funds do not expire;
promotional funding is separate with explicit expiry. Cinakey absorbs unauthorized
overruns. Successful analysis remains billable when a later rendering stage fails.

### Included subscription usage — accepted

Include **$5 retail USD usage per paid workspace month**, included in the $29 price,
with no rollover or per-seat multiplier. Grant once after confirmed initial/renewal
payment; do not grant again on seat updates or webhook retries. Additional usage uses
prepaid funds. At the 20% API margin target this represents about $4 attributable cost
if fully redeemed, before other subscription costs. This is a service allowance, not
cash, and reduces first-use payment friction. This accepted policy supersedes the
earlier no-allowance recommendation.

### Payment provider comparison

Research baseline: October 26, 2026. Polar is selected for launch, replacing the
earlier Stripe preference. Fees depend on entity, payment
mix, taxes, currency, and account terms; examples below are US domestic-card benchmarks.

| Topic                     | Stripe Payments + Billing                                              | Polar                                                                                                         |
| ------------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Seller model              | Direct processing; Cinakey retains seller responsibilities             | Merchant of record; handles indirect sales tax on supported sales                                             |
| Published example pricing | US domestic cards 2.9% + $0.30, Billing 0.7% of Billing volume         | Starter 5% + $0.50; Pro $20/month + 3.8% + $0.40; non-US card surcharge 1.5%; payout fees also apply          |
| Subscription/team fit     | Flexible subscription items and payment-contingent updates             | Native team seats, subscriptions, prepaid credits/top-up products                                             |
| Cinakey-specific policies | More direct control of base fee, seats, and payment-gated entitlements | Verify base + seat packaging, payment gating, and next-renewal decreases; native immediate reductions prorate |
| Main advantage            | Control and lower direct collection fees in the benchmark              | Less global indirect-tax operational work at launch                                                           |
| Main tradeoff             | More billing/tax operations to arrange                                 | Higher collection costs and more provider policy constraints                                                  |

Stripe also offers **Managed Payments**, a separate merchant-of-record option priced
at 3.5% in addition to Payments fees. Verify eligibility, feature fit, and actual combined
fees rather than assuming standard Stripe processing includes merchant-of-record service.

Illustration, excluding taxes, international/FX/payout fees and other add-ons:

| Purchase            | Stripe benchmark                                    | Polar Starter benchmark |
| ------------------- | --------------------------------------------------- | ----------------------- |
| $29 subscription    | About $1.34 including 0.7% Billing                  | $1.95                   |
| $10 one-time top-up | $0.59 assuming Checkout Payments, no Billing charge | $1.00                   |
| $50 one-time top-up | $1.75 on same assumptions                           | $3.00                   |

**Selected: Polar for first launch**, assuming seller/product acceptance and a
sandbox proof of the exact seat rules. For a small team selling internationally, avoiding
indirect-tax administration is likely worth the extra collection cost. This is a product
judgment, not a claim that Polar removes all business tax obligations. Keep Stripe as
the fallback if eligibility or the seat/payment flows do not fit. Do not integrate both.
At 20% API margin, collection fees must be in the rate card; encourage $25/$50 top-ups
while retaining the accepted $10 minimum. Evaluate Polar paid tiers using actual volume
and average order size rather than headline percentages alone.

For either provider, Cinakey retains its transactional USD ledger, reservations,
hierarchical budgets, and RBAC. Native provider meters do not replace admission controls.
Do not bill settled usage again after funding it through a top-up.

Sources:

- [Stripe pricing](https://stripe.com/pricing) and [Billing pricing](https://stripe.com/billing/pricing).
- [Stripe payment-contingent updates](https://docs.stripe.com/billing/subscriptions/pending-updates).
- [Stripe Managed Payments](https://stripe.com/managed-payments).
- [Polar fees](https://polar.sh/docs/merchant-of-record/fees).
- [Polar merchant-of-record model](https://polar.sh/docs/merchant-of-record/introduction).
- [Polar seats](https://polar.sh/docs/features/seat-based-pricing).
- [Polar prepaid credits](https://polar.sh/features/credits).

## Success measures

- [ ] Completed client projects and repeat projects per workspace.
- [ ] Review participation and time to approval.
- [ ] Time from production start to approved deliverable.
- [ ] Production margin and infrastructure cost per approved deliverable.
- [ ] Save/export failure rate, access incidents, and reconciliation discrepancies.

Generation volume is supporting evidence, not the primary success measure.

## Decisions still required

- [ ] Validate audience/use case and recruit pilot teams.
- [ ] Complete D1 rate-card checks; keep D2 deferred/nonblocking without migration work.
- [x] Select $5 included monthly workspace usage and Polar for launch.
- [ ] Resolve Polar’s Genjutsu policy conflict, confirm seller eligibility, and prove
      the exact payment/seat flows in an authenticated sandbox.
- [ ] Set staffing and delivery estimates after technical discovery; do not treat
      this roadmap as a schedule commitment.
- [ ] Rank Phase 2 and Phase 3 using pilot evidence rather than feature count.

## Local USD accounting progress

The local code now replaces credits with integer micro-USD, stored video quotes,
price snapshots, indexed account/scope totals and internal audit/rebuild tooling.
Workspace/series/project budget controls display dollars and distinguish holds
from settled spending. See [integration details](usd-accounting.md) for what is
verified and what remains. Final D1 rates, funding pools and recurring subscription
allowances remain open; payment-provider work is deferred. No production conversion
or compatibility layer is planned.
