#!/usr/bin/env bash
# Screenshot pages at desktop (1440x900) and mobile (390x844) with the host Chrome.
# Usage: qa/shoot.sh <outDir> name=path [name=path...]
set -euo pipefail
out="$1"; shift
base="${BASE_URL:-http://localhost:5173}"
mkdir -p "$out"
for size in "desktop 1440 900" "mobile 390 844"; do
  read -r label w h <<<"$size"
  args=()
  for p in "$@"; do args+=("${p%%=*}-$label=${p#*=}"); done
  node --experimental-websocket "$(dirname "$0")/cdp_screenshot.mjs" "$base" "$out" "$w" "$h" "${args[@]}"
done
