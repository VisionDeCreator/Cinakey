#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."
exec "${CONTAINER_ENGINE:-docker}" compose -f "${COMPOSE_FILE:-docker-compose.yml}" exec -T api bun --no-env-file apps/api/src/cli/deploy-promote-admin.ts "$@"
