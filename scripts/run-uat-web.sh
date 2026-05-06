#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

echo "Running WrestleWell web UAT checks..."
./node_modules/.bin/tsc -p apps/web/tsconfig.json --noEmit
pnpm build:web

if [ -d "tests/uat/web" ] && find "tests/uat/web" -type f | grep -q .; then
  if [ -x "./node_modules/.bin/playwright" ]; then
    echo "Running Playwright UAT tests..."
    pnpm exec playwright test tests/uat/web
  else
    echo "Playwright is not installed in this workspace yet. Skipping browser UAT execution."
  fi
else
  echo "No web UAT specs found. Web build checks passed."
fi
