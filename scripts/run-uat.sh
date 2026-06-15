#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

echo "=== WrestleWell UAT: Web ==="
./scripts/run-uat-web.sh

echo "=== WrestleWell UAT: Mobile ==="
./scripts/run-uat-mobile.sh

echo "=== WrestleWell UAT complete ==="
