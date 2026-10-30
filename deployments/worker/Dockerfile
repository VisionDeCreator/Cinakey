# syntax=docker/dockerfile:1
FROM oven/bun:1.3.14 AS dependencies
WORKDIR /app
COPY package.json bun.lock ./
COPY apps/api/package.json apps/api/package.json
COPY apps/worker/package.json apps/worker/package.json
COPY apps/web/package.json apps/web/package.json
COPY apps/admin/package.json apps/admin/package.json
COPY packages/api-client/package.json packages/api-client/package.json
COPY packages/backend/package.json packages/backend/package.json
COPY packages/config/package.json packages/config/package.json
COPY packages/shared/package.json packages/shared/package.json
COPY packages/ui/package.json packages/ui/package.json
RUN bun install --frozen-lockfile --production

FROM oven/bun:1.3.14-slim AS runtime
WORKDIR /app
COPY --from=dependencies /app/ /app/
COPY apps/api apps/api
COPY apps/worker apps/worker
COPY packages/backend packages/backend
COPY packages/shared packages/shared
COPY content/help content/help
COPY scripts/deploy-help-content.ts scripts/deploy-help-content.ts
COPY deployments/scripts/worker-health.ts deployments/scripts/worker-health.ts
ENV NODE_ENV=production
USER bun
CMD ["bun", "--no-env-file", "apps/worker/src/index.ts"]
