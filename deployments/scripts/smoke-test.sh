#!/usr/bin/env bash
set -euo pipefail
# Read-only HTTP probes; no credentials, paid calls, or data mutations.
API_URL="${API_URL:-http://127.0.0.1:8082}"
WEB_URL="${WEB_URL:-http://127.0.0.1:8080}"
ADMIN_URL="${ADMIN_URL:-http://127.0.0.1:8081}"
for url in "$API_URL/health" "$API_URL/ready" "$WEB_URL/health" "$WEB_URL/" "$ADMIN_URL/health" "$ADMIN_URL/"; do
  curl --fail --silent --show-error --max-time 10 --output /dev/null "$url"
done
echo "API readiness and frontend HTTP probes passed. Verify login, R2, and worker operations separately."
