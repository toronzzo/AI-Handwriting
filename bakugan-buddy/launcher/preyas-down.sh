#!/usr/bin/env bash
# Stop only the processes this launcher starts.
#
# Matching is by exact command line, so an unrelated app that happens to use one
# of our ports is never touched.
set -euo pipefail

REPO_ROOT="${PREYAS_REPO_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
DRIVE="/Volumes/Agent"
AGENT="$DRIVE/agent"
LOGS="$AGENT/logs"

say() { printf '%s %s\n' "$(date '+%H:%M:%S')" "$*"; }

stop_by_pidfile() {
  local file="$1" label="$2" pid
  [[ -f "$file" ]] || return 0
  pid="$(cat "$file" 2>/dev/null || true)"
  if [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null; then
    kill "$pid" 2>/dev/null && say "Stopped $label (pid $pid)." || true
  fi
  rm -f "$file"
}

# Exact command matches for the things we launch ourselves.
stop_matching() {
  local pattern="$1" label="$2" count=0 pid
  while read -r pid; do
    [[ -z "$pid" ]] && continue
    kill "$pid" 2>/dev/null && count=$((count + 1)) || true
  done < <(pgrep -f "$pattern" 2>/dev/null || true)
  (( count > 0 )) && say "Stopped $count $label." || true
}

stop_by_pidfile "$LOGS/preyas-web.pid" "web app"
stop_by_pidfile "$LOGS/preyas-proxy.pid" "brain proxy"

# Fall back to exact paths when a pid file is missing (for example after a reboot).
stop_matching "$REPO_ROOT/bakugan-buddy/brain-server/proxy.mjs" "brain proxy"
stop_matching "$REPO_ROOT/bakugan-buddy/apps/mobile/node_modules/.bin/expo start" "web app"
stop_matching "$REPO_ROOT/tools/agent-drive/gateway/start.sh" "gateway"

# llama-server and whisper belong to the drive's own launcher, so they are left
# alone unless they were started from this repo's tooling.
if [[ -f "$LOGS/llama.pid" ]]; then
  stop_by_pidfile "$LOGS/llama.pid" "llama-server"
fi

say "Preyas stopped. Outside apps and the Agent drive are untouched."
