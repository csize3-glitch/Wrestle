#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

echo "Running WrestleWell mobile UAT checks..."
./node_modules/.bin/tsc -p apps/mobile/tsconfig.json --noEmit

if [ -d "tests/uat/mobile" ] && find "tests/uat/mobile" -type f | grep -q .; then
  if command -v maestro >/dev/null 2>&1; then
    echo "Maestro detected. Run sanitized flows from tests/uat/mobile manually or extend this script for your device setup."
  else
    echo "Maestro CLI is not installed in this shell. Skipping device UAT execution."
  fi
else
  echo "No mobile UAT flows found. Mobile typecheck passed."
fi
