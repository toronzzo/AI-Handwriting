#!/usr/bin/env bash
# Serve the local Kiwix packs for the brain server only.
#
# kiwix-serve stays on 127.0.0.1:8791 and is deliberately NOT configurable to a
# LAN address: the brain server proxies search, pictures and articles so that
# paired devices never talk to kiwix-serve directly. Prefer the Agent-drive
# binary if present (Homebrew no longer ships kiwix-tools on this Mac):
#
#   /Volumes/Agent/agent/bin/kiwix-serve
#
# CI does not install kiwix-tools and never downloads packs.
set -euo pipefail

ZIM_DIR="${PREYAS_ZIM_DIR:-/Volumes/Agent/agent/knowledge/zim}"
PORT="${PREYAS_KIWIX_PORT:-8791}"
PATH="/Volumes/Agent/agent/bin:${PATH:-/usr/bin:/bin}"

if ! command -v kiwix-serve >/dev/null 2>&1; then
  echo "kiwix-serve is not installed. See bakugan-buddy/docs/OFFLINE.md" >&2
  exit 127
fi

if ! [[ "$PORT" =~ ^[0-9]+$ ]] || (( PORT < 1 || PORT > 65535 )); then
  echo "PREYAS_KIWIX_PORT must be a port number, got '$PORT'" >&2
  exit 2
fi

mkdir -p "$ZIM_DIR"
shopt -s nullglob
zims=("$ZIM_DIR"/*.zim)
if [[ ${#zims[@]} -eq 0 ]]; then
  echo "No .zim packs found in $ZIM_DIR" >&2
  exit 1
fi

echo "Serving ${#zims[@]} pack(s) on http://127.0.0.1:${PORT} (loopback only)"
exec kiwix-serve --address 127.0.0.1 --port "$PORT" "${zims[@]}"
