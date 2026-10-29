# Dirrio brand and infrastructure transition

All applications, workspace package names/imports, translation catalogs, email copy, public URL defaults, document namespaces, deployment images and Compose projects now use Dirrio. Browser drag types, share cookies, webhook headers, payment metadata writers and provider request identifiers use the current name too.

Document readers accept supported format/version pairs from historical namespaces, validate their payloads and emit canonical `dirrio.*` schemas on assertion/export. Browser startup copies known same-origin locale, layout, workspace and recovery-draft keys into the current namespace without deleting originals or overwriting newer values. This cannot transfer local browser storage between different domains; export important local-only drafts before changing domains.

New payment receipts use `dirrio_intent`, `dirrio_workspace` and `dirrio_refund`. Historical receipt identities remain readable by their stable metadata suffixes. Conflicting identities fail closed rather than binding to a different checkout or refund. Remote receipts are never rewritten by the branding change.

## New infrastructure

Local bucket and deployment selector names have been updated to the new brand. This repository change does not provision R2 buckets, create Convex deployments, issue new credentials, register domains, or move existing data. Before deploying:

1. Create the new development/production Convex deployments and update `CONVEX_DEPLOYMENT`, `CONVEX_URL`, `CONVEX_DEPLOY_KEY`, and `VITE_CONVEX_URL` consistently. Configure JWT/JWKS, site origins, optional Google OAuth and payment/staging flags on the new deployment. Existing ignored credentials are not automatically valid for a new deployment.
2. Create private Dirrio R2 buckets, configure CORS for the new web/admin origins and supply bucket-scoped credentials to API/worker. A renamed bucket string does not move existing objects. If retaining data, migrate bytes and their Convex metadata together before cutover.
3. Configure the new web, admin and API domains, SMTP sender identity, OAuth callback and provider/Polar webhooks. The preferred generation signature header is `x-dirrio-signature`; standard alternative generation-signature headers remain supported. Build frontend images with the new public URLs.
4. Back up existing data, pause new paid submissions and reconcile outstanding jobs/financial holds before switching environments. Deploy backend functions first, then API/worker and frontends. New domains have separate browser sessions and local storage. Password-protected sharing sessions use the new cookie name.
5. Run `bun run deploy:check`, the deployment tests and read-only smoke checks before enabling traffic. Use the canonical [deployment runbook](../deployments/README.md) for rollout and rollback.

Historical Git history, screenshots and immutable backup data remain historical evidence; the rename applies to current source, configuration, local acceptance fixtures and regenerated builds.
