#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if [ ! -f ".env.uat.local" ]; then
  echo "Missing .env.uat.local"
  exit 1
fi

set -a
# shellcheck disable=SC1091
source .env.uat.local
set +a

export PATH="$HOME/.maestro/bin:$PATH"

if ! command -v maestro >/dev/null 2>&1; then
  echo "Maestro is not installed or not on PATH."
  exit 1
fi

: "${UAT_PARENT_EMAIL:?Missing UAT_PARENT_EMAIL}"
: "${UAT_PARENT_PASSWORD:?Missing UAT_PARENT_PASSWORD}"
: "${UAT_ATHLETE_EMAIL:?Missing UAT_ATHLETE_EMAIL}"
: "${UAT_ATHLETE_PASSWORD:?Missing UAT_ATHLETE_PASSWORD}"
: "${UAT_COACH_EMAIL:?Missing UAT_COACH_EMAIL}"
: "${UAT_COACH_PASSWORD:?Missing UAT_COACH_PASSWORD}"

UAT_MOBILE_APP_ID="${UAT_MOBILE_APP_ID:-com.csize8.wrestlewell}"
export UAT_MOBILE_APP_ID
export UAT_TIMESTAMP="$(date +%Y%m%d%H%M%S)"
RESOLVED_DIR=".uat-mobile-resolved"
rm -rf "$RESOLVED_DIR"
mkdir -p "$RESOLVED_DIR"

METRO_PID=""
cleanup() {
  rm -rf "$RESOLVED_DIR"
  if [ -n "$METRO_PID" ] && kill -0 "$METRO_PID" >/dev/null 2>&1; then
    kill "$METRO_PID" >/dev/null 2>&1 || true
    wait "$METRO_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT

if ! curl -fsS "http://127.0.0.1:8081" >/dev/null 2>&1; then
  echo "Starting Metro for mobile UAT..."
  pnpm --filter mobile start -- --host localhost >/tmp/wrestlewell-uat-mobile-metro.log 2>&1 &
  METRO_PID=$!

  for _ in $(seq 1 60); do
    if curl -fsS "http://127.0.0.1:8081" >/dev/null 2>&1; then
      break
    fi

    if ! kill -0 "$METRO_PID" >/dev/null 2>&1; then
      echo "Metro exited early. Output:"
      cat /tmp/wrestlewell-uat-mobile-metro.log || true
      exit 1
    fi

    sleep 1
  done

  if ! curl -fsS "http://127.0.0.1:8081" >/dev/null 2>&1; then
    echo "Timed out waiting for Metro on http://127.0.0.1:8081"
    cat /tmp/wrestlewell-uat-mobile-metro.log || true
    exit 1
  fi
fi

python3 - <<'PY'
from pathlib import Path
import os

root = Path(".")
templates = {
    "parent-smoke.template.yaml": {
        "__UAT_MOBILE_APP_ID__": os.environ.get("UAT_MOBILE_APP_ID", "com.csize8.wrestlewell"),
        "__UAT_PARENT_EMAIL__": os.environ["UAT_PARENT_EMAIL"],
        "__UAT_PARENT_PASSWORD__": os.environ["UAT_PARENT_PASSWORD"],
    },
    "athlete-smoke.template.yaml": {
        "__UAT_MOBILE_APP_ID__": os.environ.get("UAT_MOBILE_APP_ID", "com.csize8.wrestlewell"),
        "__UAT_ATHLETE_EMAIL__": os.environ["UAT_ATHLETE_EMAIL"],
        "__UAT_ATHLETE_PASSWORD__": os.environ["UAT_ATHLETE_PASSWORD"],
        "__UAT_TIMESTAMP__": os.environ["UAT_TIMESTAMP"],
    },
    "coach-smoke.template.yaml": {
        "__UAT_MOBILE_APP_ID__": os.environ.get("UAT_MOBILE_APP_ID", "com.csize8.wrestlewell"),
        "__UAT_COACH_EMAIL__": os.environ["UAT_COACH_EMAIL"],
        "__UAT_COACH_PASSWORD__": os.environ["UAT_COACH_PASSWORD"],
    },
}

template_dir = root / "tests" / "uat" / "mobile"
resolved_dir = root / ".uat-mobile-resolved"

for template_name, replacements in templates.items():
    text = (template_dir / template_name).read_text()
    for old, new in replacements.items():
        text = text.replace(old, new)
    out_name = template_name.replace(".template", "")
    (resolved_dir / out_name).write_text(text)
PY

echo "Running mobile typecheck..."
./node_modules/.bin/tsc -p apps/mobile/tsconfig.json --noEmit

run_flow() {
  local name="$1"
  local file="$2"

  echo "Running ${name} mobile UAT..."
  if ! maestro test "$file"; then
    echo
    echo "${name} mobile UAT failed."
    echo "Most common cause: the simulator is still signed into the wrong WrestleWell role."
    echo "If needed, open the app, sign out manually, dismiss the Expo dev menu, and rerun ./scripts/run-uat-mobile.sh."
    echo "Maestro debug artifacts are under \$HOME/.maestro/tests/."
    exit 1
  fi
}

run_flow "Parent" "$RESOLVED_DIR/parent-smoke.yaml"
run_flow "Athlete" "$RESOLVED_DIR/athlete-smoke.yaml"
run_flow "Coach" "$RESOLVED_DIR/coach-smoke.yaml"

echo "Mobile UAT complete."
