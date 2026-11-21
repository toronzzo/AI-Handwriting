#!/usr/bin/env bash
set -euo pipefail

ZIM_DIR="${PREYAS_ZIM_DIR:-/Volumes/Agent/agent/knowledge/zim}"
PORT="${PREYAS_KIWIX_PORT:-8791}"

if ! command -v kiwix-serve >/dev/null 2>&1; then
  echo "kiwix-serve is not installed. Run: brew install kiwix-tools" >&2
  exit 127
fi

mkdir -p "$ZIM_DIR"
shopt -s nullglob
zims=("$ZIM_DIR"/*.zim)
if [[ ${#zims[@]} -eq 0 ]]; then
  echo "No .zim packs found in $ZIM_DIR" >&2
  exit 1
fi

exec kiwix-serve --address 127.0.0.1 --port "$PORT" "${zims[@]}"
