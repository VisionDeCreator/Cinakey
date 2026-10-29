#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."
app="${1:-all}"
case "$app" in
  all) exec docker compose build ;;
  api|worker|web|admin) exec docker compose --env-file "deployments/$app/.env" -f "deployments/$app/docker-compose.yml" build ;;
  *) echo "Usage: $0 <all|api|worker|web|admin>" >&2; exit 1 ;;
esac
