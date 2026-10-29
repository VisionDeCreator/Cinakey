# syntax=docker/dockerfile:1
FROM oven/bun:1.3.14 AS builder
WORKDIR /app
COPY . .
RUN bun install --frozen-lockfile
ARG VITE_CONVEX_URL
ENV VITE_CONVEX_URL=$VITE_CONVEX_URL
ARG VITE_API_URL
ENV VITE_API_URL=$VITE_API_URL
ARG VITE_WEB_URL
ENV VITE_WEB_URL=$VITE_WEB_URL
ARG VITE_APP_ENV
ENV VITE_APP_ENV=$VITE_APP_ENV
RUN bun run --cwd apps/admin build

FROM nginx:1.28.0-alpine AS runtime
COPY deployments/admin/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/apps/admin/dist /usr/share/nginx/html
HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD wget -q -O /dev/null http://127.0.0.1/health || exit 1
