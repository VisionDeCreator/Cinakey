# Generation pricing — October 28, 2026

Version: `usd-2026-10-28-cost-plus-v2`. USD amounts exclude checkout tax. This policy supersedes the earlier 20% margin and 15% fee allocation.

## Commercial setting

`USAGE_MARKUP_BPS = 500` in `packages/shared/src/pricing.ts` adds **5% to supplier cost**. Set it to zero for supplier-cost passthrough. Change `PRICE_VERSION` whenever changing the commercial setting or supplier rates. Accepted quotes and jobs pin their markup and rate snapshots.

Final customer charge is `ceil(supplier USD micros × (10000 + markupBps) / 10000)`, capped at the accepted reservation. This is a markup, not a guaranteed margin after fees. Collection fees, failed operations and operating costs are funded from subscriptions and seats. The $5 included workspace allowance uses the same usage prices. Payment enablement and subscription prices are unchanged.

## Video estimates and final charges

| Operation                         | Resolution | Supplier USD/second | Five-second customer maximum |
| --------------------------------- | ---------- | ------------------: | ---------------------------: |
| Seedance 2.5                      | 720p       |              0.2312 |                     1.218000 |
| Seedance 2.5                      | 1080p      |              0.5686 |                     2.992500 |
| Remix Lite Object Swap / Genjutsu | 720p       |              0.1000 |                     0.525000 |
| Remix Lite Object Swap / Genjutsu | 1080p      |              0.2000 |                     1.050000 |

Quotes round the supplier estimate upward to a whole cent before adding markup, because the verified Sume captured ledger reports cents. This allowance is a reservation, not an extra charge. Before submission, the free estimator checks the exact payload against the accepted maximum. An unavailable, malformed or higher estimate stops paid submission.

After completion, settlement reads the final captured `usage_summary` from `GET /v1/jobs/{id}`. Prefer integer `captured_usd_micros` when available; otherwise use `captured_usd_cents × 10000`. A final captured receipt is required. Missing receipts retry and retain the financial hold for reconciliation. Store estimates and captured receipts separately; repeated settlement cannot charge twice or overwrite a conflicting receipt.

For example, a supplier capture of $1.16 costs the customer $1.218. A $2.84 capture costs $2.982, releasing $0.0105 from the $2.9925 reservation. If the receipt plus markup exceeds the accepted maximum, cap the customer charge and flag reconciliation.

Seedance supports the existing 4–30-second operations. Remix Lite uses the dedicated `/v1/sume/remix-lite/object-swap/v1.0` endpoint and existing 4–15-second range, with source duration rounded up once. The router alias that bills source plus output is not interchangeable. Genjutsu analysis is separately metered and included in the combined estimate.

## DeepSeek peak and off-peak pricing

All supported text/vision calls use `deepseek-flash`, bounded output and disabled thinking. Current [official rates and timing](https://api-docs.deepseek.com/quick_start/pricing/) are:

| Token category | Peak supplier USD/million | Off-peak supplier USD/million | Peak with 5% | Off-peak with 5% |
| -------------- | ------------------------: | ----------------------------: | -----------: | ---------------: |
| Cached input   |                     0.006 |                         0.003 |       0.0063 |          0.00315 |
| Uncached input |                      0.30 |                          0.15 |        0.315 |           0.1575 |
| Output         |                      1.20 |                          0.60 |         1.26 |             0.63 |

Peak is Monday–Friday 01:00–04:00 and 06:00–10:00 UTC, excluding Chinese public holidays; all other periods are off-peak. The verified 2026 holiday calendar follows the [government notice](https://www.beijing.gov.cn/zhengce/zhengcefagui/202511/t20251104_4258873.html). Maintain the calendar before each new year. Unknown-year potential peak periods require reconciliation.

Each call records canonical input, cache-hit and output counts plus the provider's `created` timestamp and verified billing period. The request window must remain within a single period, and the provider timestamp must agree with that window. Missing timestamps/cache evidence, inconsistent usage or boundary-spanning requests retain the reservation for reconciliation rather than guessing the provider's rate. Calls in different periods within one staging job are supported as separate batches.

Sum exact category costs across all batches, applying the off-peak half-rate per batch; round supplier cost up once to micro-USD, then apply the pinned markup once. Customer rounding can differ from an invoice aggregated across many requests by micro-USD. DeepSeek does not return a documented per-call dollar receipt, so this is reconstructed supplier cost from published rates and metered usage, pending invoice reconciliation.

Reservations use conservative peak bounds. Every paid call checks its remaining budget first. Staging stops paid repairs when metering is incomplete; autofill and analysis settle measured usage. Customer charges never exceed their accepted maximum; unexpected overages are flagged. Failed operations release the customer hold.

## Evidence and launch qualification

Supplier catalog and exact free estimates were checked October 28, 2026. [Saved sanitized estimator evidence](evidence/generation-price-verification.json) covers Seedance variants and the dedicated Remix Lite endpoint. [Historical captured receipt evidence](evidence/generation-captured-receipts.json) confirms Sume's final captured cents. Sources: [Sume billing](https://www.sume.com/docs/billing), [job API](https://www.sume.com/docs/jobs), [DeepSeek response schema](https://api-docs.deepseek.com/api/create-chat-completion/).

- [x] Configurable 5% markup; zero and alternate percentages tested.
- [x] Quotes, captured video settlement, reservation refunds and retry idempotency tested.
- [x] DeepSeek cache categories, mixed peak/off-peak calls, holidays, boundaries and missing evidence tested.
- [ ] Compare a capped live generation and DeepSeek invoice with provider billing before production qualification.
- [ ] Maintain future holiday calendars and reconcile any account-specific supplier discounts or changed rates.

No new paid generation or customer payment was submitted for this verification. Production payments and live-generation enablement are unchanged. D2 remains nonblocking; no legacy credit conversion is required.

Validation: 516 automated tests pass (178 backend, 79 API, 167 web, 92 shared), plus typecheck, lint, build and credential checks. Development deployment readback verifies all four five-second quote maxima in the table, and local API health passes.
