#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if [ -f ".env.uat.local" ]; then
  set -a
  # shellcheck disable=SC1091
  source .env.uat.local
  set +a
fi

export UAT_WEB_URL="${UAT_WEB_URL:-http://localhost:3000}"

HOST_AND_PORT="$(python3 - <<'PY'
from urllib.parse import urlparse
import os
url = urlparse(os.environ["UAT_WEB_URL"])
host = url.hostname or "127.0.0.1"
port = url.port or (443 if url.scheme == "https" else 80)
print(f"{host} {port}")
PY
)"
HOST="$(printf '%s' "$HOST_AND_PORT" | awk '{print $1}')"
PORT="$(printf '%s' "$HOST_AND_PORT" | awk '{print $2}')"

if [ "$HOST" = "localhost" ]; then
  HOST="127.0.0.1"
  export UAT_WEB_URL="$(python3 - <<'PY'
from urllib.parse import urlparse, urlunparse
import os
parts = urlparse(os.environ["UAT_WEB_URL"])
netloc = f"127.0.0.1:{parts.port}" if parts.port else "127.0.0.1"
print(urlunparse((parts.scheme or "http", netloc, parts.path, "", "", "")))
PY
)"
fi

SERVER_PID=""
cleanup() {
  if [ -n "$SERVER_PID" ] && kill -0 "$SERVER_PID" >/dev/null 2>&1; then
    kill "$SERVER_PID" >/dev/null 2>&1 || true
    wait "$SERVER_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT

echo "Cleaning stale Next output..."
rm -rf apps/web/.next

echo "Running web build..."
pnpm build:web

echo "Starting web server on $UAT_WEB_URL ..."
pnpm --filter web exec next start -H "$HOST" -p "$PORT" >/tmp/wrestlewell-uat-web.log 2>&1 &
SERVER_PID=$!

echo "Waiting for $UAT_WEB_URL ..."
for _ in $(seq 1 60); do
  if curl -fsS "$UAT_WEB_URL" >/dev/null 2>&1; then
    break
  fi

  if ! kill -0 "$SERVER_PID" >/dev/null 2>&1; then
    echo "Web server exited early. Output:"
    cat /tmp/wrestlewell-uat-web.log || true
    exit 1
  fi

  sleep 1
done

if ! curl -fsS "$UAT_WEB_URL" >/dev/null 2>&1; then
  echo "Timed out waiting for $UAT_WEB_URL"
  echo "Server output:"
  cat /tmp/wrestlewell-uat-web.log || true
  exit 1
fi

if [ ! -x "./node_modules/.bin/playwright" ]; then
  echo "Playwright is not installed in this workspace."
  exit 1
fi

echo "Running Playwright web UAT..."
pnpm exec playwright test tests/uat/web
