# Seven day workspace trial implementation plan

Status: core implementation completed following user approval. October 31, 2026. Pricing and trial code are implemented locally; production deployment and launch qualification remain separate.

Give new verified owners seven days to evaluate production workflows without a subscription. Generation requires purchased USD balance; the trial grants no free generation. Subscription conversion requires an explicit checkout. Preserve purchased balances and completed work when the trial ends.

## Implementation results

- Implemented server-owned trial timing, one-trial-per-owner eligibility, project/series/episode/Genjutsu start paths and atomic rollback on failed creation.
- Implemented trial top-ups without subscriptions, explicit paid conversion, purchased-only residual reservations, queued-job expiry checks and independent editing/generation capabilities.
- Updated pricing to 20% supplier markup and $10 additional seats, keeping $29 base pricing, $5 monthly included usage and existing top-up denominations. Old accepted quote snapshots remain valid.
- Added trial confirmation, expiry/billing copy, $25 top-up emphasis and translations in all six interface languages. Trial enrollment defaults off through `WORKSPACE_TRIAL_ENABLED`; API/worker/Convex must agree on this flag before payments start.
- Polar sandbox catalog was inspected and updated: one canceled subscription, no active subscriptions, one active graduated price with $29 first seat and $10 additional seats. Product readback passed the application validator. Production catalog and subscriptions were not changed.
- Automated coverage includes first trial top-up checkout/webhook reconciliation, exact expiry, duplicate funding, residual generation, late payment, failed creation, seat limits, paid conversion and queued jobs backed by purchased funds.

All 870 application tests and the deployment/environment checks pass. Type checking and the production build pass. The changed TypeScript files pass lint. Repository-wide lint has four existing errors in unchanged `adminAnalytics.ts` files. The UI package now includes its installed Node type declarations because its typed backend API references server modules during compilation.

Remaining launch qualification: deploy schema/backend/API/frontend together, enable the enrollment flag for the intended cohort, perform the manual browser sandbox flow, and reconcile a capped live generation against supplier billing before enabling production payments. Cohort analytics and the first-local-export event remain follow-up launch instrumentation; existing trial timestamps, payment orders and generation records preserve the primary conversion milestones.

## Product policy

| Item          | Planned behavior                                                                                                                                                                                                                                                   |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Eligibility   | One trial per verified owner account, allocated to one workspace. Creating workspaces, deleting projects, transferring ownership or returning from checkout never resets eligibility.                                                                              |
| Start         | First successful production creation by the owner: standalone project, series or Genjutsu session. Creating an empty workspace or signing up does not start the clock. Creating an episode in an existing series must resolve through the same eligibility policy. |
| Duration      | Exactly 168 hours, using server timestamps. Access expires when now is greater than or equal to the stored expiry. Show the exact local expiry date and time.                                                                                                      |
| Seats         | One creator, including the owner, during the trial. Joining another owner's workspace does not consume personal trial eligibility. Existing role permissions continue to apply.                                                                                    |
| Functionality | Production editing, staging, imports, generation, export and sharing within existing storage and upload limits. Every metered operation, including analysis/staging calls, still needs available balance.                                                          |
| Payments      | No subscription card required. Verified owner can buy existing $10/$25/$50 USD top-ups during the active trial. No automatic subscription or renewal at expiry.                                                                                                    |
| Upgrade       | Explicit normal subscription checkout at any time. Successful subscription payment grants the existing $5 monthly allowance once for that paid period. Purchased funds remain separate and non-expiring.                                                           |
| Expiry        | Retain read, download, local export, billing and deletion access subject to existing permissions. Allow generation preparation while purchased funds remain, with full editing and other production features subscription-only.                                    |

Trial start at first production creation follows the preceding recommendation; the original signup wording should be updated consistently. Explain before first production creation that the seven-day period starts now. A failed creation must not consume eligibility.

## Residual balance after expiry

Purchased funds must remain usable without forcing a subscription. While a purchased balance remains, allow standalone project and Genjutsu-session creation, scripts and script segments, image/video reference uploads and binding, basic generation settings and generation. Existing projects receive the same preparation access. Keep the generic project-write assertion restricted: timeline, staging, series/shared-library management, collaboration and publishing remain subscription-only.

New series/episodes, team expansion, audio/JSON uploads and further top-ups remain unavailable in this expired state. Only image/video reference uploads are permitted, with access rechecked during upload admission, completion and asset attachment. A reservation must be fully backed by purchased funds; trial eligibility itself supplies no spending authority. Exhausting the available purchased balance removes creation, script editing, uploads and generation access, while downloads and exports remain available. Existing holds can complete and settle normally; released funds return to their original pool and remain spendable. Resolve any purchase authorized before expiry through normal webhook reconciliation even if it is paid after expiry.

This restriction is a proposed product choice: it preserves balance usability without creating a perpetual pay-as-you-go workspace. State it clearly before the first top-up purchase. Current retention decision: keep projects and media indefinitely, including after trial expiry, unless the user deletes them. Revisit retention separately if costs warrant it, with advance notice and export access before introducing any limit.

## Current implementation constraints

- `packages/backend/convex/lib/paymentAccess.ts` centralizes production authorization, paid seats and past-due grace. Without payment state, production depends on `SUBSCRIPTION_PAYWALL_ENABLED`; trial access must not inherit an unlimited legacy bypass.
- `packages/backend/convex/payments.ts` rejects top-ups without a usable subscription in `prepareCheckout`. A top-up also creates payment state, so payment-state presence cannot determine whether trial access survives.
- `apps/api/src/services/payments.ts` owns Polar checkout/product validation and reconciliation. Preserve owner checks, verified email, environment binding and idempotency.
- `packages/backend/convex/projects.ts` and other production mutations use shared payment authorization. First-production creation needs an atomic trial-start path before the usual write check can succeed.
- `apps/web/src/features/settings/BillingPage.tsx` and `BillingSettings.tsx` need trial status and independent purchase/subscription controls.
- `packages/shared/src/pricing.ts` currently uses 5% generation markup. Current paid seat pricing remains $29 plus $15 per additional creator/admin.

## Phase 1 Data and access policy

- [ ] Add durable owner trial eligibility and workspace trial records, with server-owned `startedAt`, `expiresAt`, owner identity and environment. Use transactional checks to prevent concurrent claims across workspaces. Retain consumed eligibility when a workspace is deleted.
- [ ] Return explicit access capabilities: create production, edit production, run generation, purchase usage, export/read and manage seats; include access reason and expiry. Keep application membership separate from commercial permissions.
- [ ] Resolve restricted/paused workspaces first, then internal workspaces, then paid entitlements, trial access and residual-balance access. Suspension and environment mismatch cannot be bypassed by trial status.
- [ ] Keep paid past-due grace separate from trial duration. Subscription cancellation or payment failure never restarts a trial. A checkout attempt alone must not end a still-valid trial; confirmed paid access takes precedence.
- [ ] Start the trial and create the first production in one transaction. Concurrent creation uses one timestamp and never extends expiry. If confirmation is a separate UI step, do not consume the trial until creation succeeds.
- [ ] Use request-time server authorization at every protected operation; scheduled expiry is only for notifications and analytics. Ensure reactive UI expiry updates without waiting for a database write.

## Phase 2 Payments and generation

- [ ] Permit trial-owner top-ups without a Polar subscription. Keep existing fixed products and server-validated amounts; do not configure this as a Polar subscription trial.
- [ ] Return billing identity even when subscription identity is absent. Reconcile top-ups without marking the workspace subscribed or disabling trial entitlements.
- [ ] Preserve webhook-only funding, immutable order provenance, duplicate-event protection, reversals and environment isolation.
- [ ] Implement residual generation as narrowly authorized operations across API, backend, reservation, upload/file and worker boundaries. Do not relax the generic project-write assertion.
- [ ] Require both generation access and sufficient eligible funds. Budget caps, supplier-cost capture and quote maximums continue to apply.
- [ ] Specify expiry races: paid work already submitted completes; a reservation not yet submitted must recheck access and either use the residual path or release. Late supplier callbacks settle exactly once.
- [ ] Prevent expiry from breaking worker output storage, settlement or output downloads; system completion authority is distinct from user edit authority.

## Phase 3 User experience

- [ ] Signup/onboarding copy: “Try the workspace free for seven days. AI generation is paid separately.” Explain the start trigger, post-trial restrictions and minimum top-up.
- [ ] Show “Start seven-day trial” on first production creation, with a clear confirmation of the start rule. No subscription card form.
- [ ] Show remaining time and exact expiry in workspace and Billing. Separate “Buy generation balance” from “Subscribe for $29/month.”
- [ ] Before a purchase, show a representative generation estimate and explain that provider/model/settings affect the number of clips.
- [ ] At expiry, show upgrade, remaining purchased balance, residual generation and export/download actions. Preserve projects and balances visibly.
- [ ] Ensure all core production entry points handle trial start and expiry: projects, series/episodes, Genjutsu, templates/imports and direct links.
- [ ] Add localized strings and accessible states. Non-owner members see appropriate access status without receiving purchase permission.

## Phase 4 Commercial configuration

Approval status: approved by the user. Pricing and trial changes are implemented together. Polar sandbox product readback confirms the $29 first seat and $10 additional-seat tiers; production billing has not been modified.

| Component                        | Current policy                         | Proposed policy                                                                                                                     |
| -------------------------------- | -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Base workspace subscription      | $29/month, owner included              | Keep $29/month, owner included                                                                                                      |
| Additional Admin/Creator         | $15/month each                         | $10/month each; no extra included creator                                                                                           |
| Reviewers                        | Free                                   | Keep free; existing permissions apply                                                                                               |
| Included usage                   | $5 retail USD per paid workspace month | Keep $5, shared across workspace, no rollover and no additional allowance per seat                                                  |
| Generation and metered AI markup | Supplier cost plus 5%                  | Supplier cost plus 20%, including video, transformations and metered analysis/staging calls                                         |
| Top-ups                          | $10/$25/$50                            | Keep the same balance amounts and purchase prices; present $25 as the default suggested amount, with explicit checkout confirmation |
| Purchased balance                | Non-expiring USD funding               | Keep non-expiring; no balance conversion or haircut when rates change                                                               |
| Annual plans and discounts       | Not part of this launch offer          | No annual plan or promotional discount in this implementation                                                                       |

Seat totals before checkout tax become $29 for one creator, $39 for two, $49 for three and $69 for five. Reviewers do not count toward these totals. The active trial includes only the owner creator seat; a team needing additional creators must explicitly subscribe and purchase sufficient capacity.

The commercial formula is `retail = supplier cost × 1.20`, with existing integer micro-USD rounding, accepted quote ceilings and supplier receipt settlement preserved. This is a 20% markup, equivalent to a 16.67% margin before payment and operating costs; do not label it a guaranteed 20% profit margin. For example, a $1.00 supplier charge becomes $1.20 retail instead of $1.05. The same retail schedule applies to included and purchased funds. Provider rate definitions and DeepSeek billing-period logic are not changed by the markup update.

The $5 included retail allowance corresponds to approximately $4.17 supplier cost at full redemption, before collection and operating costs. A $25 top-up funds $25 retail USD; it does not buy $25 of supplier costs. Customer-facing estimates must reflect the new rates before generation.

- [ ] Set `USAGE_MARKUP_BPS` to 2000 in `packages/shared/src/pricing.ts`, bump `PRICE_VERSION`, and update pricing documentation and representative quote examples. Previously accepted unexpired quotes and submitted jobs keep their stored prices; new quotes use the new version.
- [ ] Align all seat constants, checkout validation, renewal/seat-change reconciliation, UI copy, receipts displayed by the app and tests with $29 plus $10 per additional seat. Search for the previous $15 value by meaning rather than blindly replacing numbers.
- [ ] Create or update the intended Polar sandbox product configuration to first seat 2,900 cents and additional seats 1,000 cents. Validate the actual product shape and full sandbox checkout/renewal flow. Do not silently modify archived products or unrelated subscriptions.
- [ ] Before production catalog migration, inventory existing subscriptions. Existing paid customers retain their current terms until an explicit migration is designed; avoid retroactive invoice changes or incidental prorations. If the production inventory is empty as expected for this prelaunch product, record that result and configure the launch product directly. Support a versioned legacy price mapping if any existing subscriptions are found.
- [ ] Keep the $5 allowance exclusive to successfully paid subscription periods. Trial start, a top-up, seat additions and prorations grant no extra allowance.
- [ ] Keep top-up selection explicit: $25 may be preselected or emphasized, but opening Billing never creates a checkout or charge. No auto-recharge or automatic post-trial subscription.
- [ ] Retain existing storage/upload enforcement in this change; do not market unlimited storage or introduce automatic storage overage charges. Reconcile advertised limits with enforced limits before launch.
- [ ] Verify realized economics using provider receipts and actual Polar fees before enabling production purchases. Never assume the estimated founder budget guarantees realized margins.

Deliver the trial, price version, seat pricing, billing copy and tests together. Production payment/generation enablement remains a deliberate launch step after sandbox acceptance, rather than a side effect of deploying code.

## Phase 5 Verification

Extend `subscriptionPaywall.test.ts`, `payments.test.ts`, API payment tests and Billing tests. Add focused integration coverage where these systems meet.

- [ ] Verified eligibility, unverified denial, all first-production triggers, failed creation, simultaneous claims, deleted/recreated workspace and ownership transfer.
- [ ] Exact expiry boundary, client clock manipulation, trial UI expiry and disabled/enabled rollout behavior.
- [ ] Trial top-up creates no subscription; signed payment funds exactly once; redirects alone fund nothing; invalid amount/environment/owner is rejected.
- [ ] Trial checkout failure, early upgrade, delayed subscription payment and one $5 allowance per successful paid period.
- [ ] Expiry with queued/running generation, outstanding holds, refunds and delayed webhooks; no free or duplicate generation.
- [ ] Residual funds can actually be spent and outputs downloaded without a subscription. Zero balance blocks preparation and generation. Fresh top-ups, general editor writes, staging, collaboration and unauthorized upload types remain blocked.
- [ ] Internal workspaces, paused workspaces, RBAC, paid seat capacity, existing paid subscriptions and past-due grace retain intended behavior.
- [ ] New quotes apply exactly 20% markup with correct rounding; old accepted quotes/jobs retain their snapshots; balances remain numerically unchanged. Metered analysis and transformations use the same markup policy.
- [ ] One/two/three/five paid creators quote $29/$39/$49/$69 before tax. Reviewer additions are free; additional creators grant no extra usage allowance. Top-ups still fund exactly $10/$25/$50 once.
- [ ] Browser acceptance: verified signup → first project → $10 sandbox top-up → generation → simulated expiry → residual generation/download → explicit subscription upgrade.

Run relevant backend/API/web tests, then repository typecheck, lint and build. Use sandbox fixtures and controlled clocks; do not wait seven real days or submit paid live generations for routine tests.

## Rollout and measurement

1. Add a dedicated trial feature flag and deploy backward-compatible schema/backend support first. Do not automatically grant trials to existing paid or internal workspaces.
2. Launch cohort policy: existing verified unpaid owners may enroll when the trial flag is enabled, provided their owner record has no consumed trial and the selected workspace has no prior subscription. Existing paid and internal workspaces are excluded.
3. Validate the full sandbox flow, including residual access, before enabling new production cohorts.
4. Preserve started trials through their promised expiry if new trial enrollment is disabled. Preserve purchased-balance access on rollback. Avoid deleting records or restoring a generic unlimited-access fallback.
5. Track signup, trial start, first top-up, first successful generation, first export, expiry and first paid subscription with workspace-scoped deduplicated events. Report conversion by trial-start cohort and distinguish owner/internal activity.
6. Track cost per non-converting trial, top-up contribution, payment failures and support load. Keep the initial cohort small enough to replace the estimated operating budget with measured bills.

## Completion criteria

A verified new owner can evaluate production for exactly seven days, buy and spend generation balance without a subscription, retain useful access to purchased funds after expiry, and explicitly upgrade without lost work or duplicate allowances. Every server entry point enforces the same capability policy, and sandbox acceptance confirms the full lifecycle.
