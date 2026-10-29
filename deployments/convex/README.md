# Cinakey convex deployment

See the [deployment runbook](../README.md) for environment ownership, setup, rollout and rollback.

Copy this folder's .env.example to .env without overwriting existing configuration. Real environment files must never be committed or built into images.

Commands: `bun run setup:convex-auth-keys`, `bun run sync:convex-env`, and `bun run deploy:convex`. These commands mutate the production deployment selected by the deploy key and reject development/preview keys. Check the target URL before running. Auth rotation requires `bun run setup:convex-auth-keys --rotate` and invalidates existing sessions. Deploy also syncs feature flags before uploading functions; take backups and coordinate rollout first.
