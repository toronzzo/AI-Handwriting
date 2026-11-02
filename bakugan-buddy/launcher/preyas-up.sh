#!/usr/bin/env bash
# Start everything Preyas needs, reusing whatever is already healthy.
#
# Safe to run twice: it only starts what is missing. It never kills a process it
# did not start, and it never touches the Agent drive's own files.
#
#   preyas-up.sh            start everything, then open the chat
#   preyas-up.sh --no-open  start everything, stay quiet (used by autostart)
set -euo pipefail

REPO_ROOT="${PREYAS_REPO_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
DRIVE="/Volumes/Agent"
BUDDY="$DRIVE/BakuganBuddy"
AGENT="$DRIVE/agent"
LOGS="$AGENT/logs"
BRAIN="$REPO_ROOT/bakugan-buddy/brain-server"
MOBILE="$REPO_ROOT/bakugan-buddy/apps/mobile"
GATEWAY="$REPO_ROOT/tools/agent-drive/gateway/start.sh"
WEB_PORT="${PREYAS_WEB_PORT:-8081}"

OPEN_BROWSER=1
for arg in "$@"; do
  [[ "$arg" == "--no-open" ]] && OPEN_BROWSER=0
done

mkdir -p "$LOGS"
LOG="$LOGS/preyas-up.log"

say() { printf '%s %s\n' "$(date '+%H:%M:%S')" "$*" | tee -a "$LOG"; }

dialog() {
  # A macOS dialog that never blocks a script run from LaunchAgent.
  osascript -e "display dialog \"$1\" with title \"Preyas\" buttons {\"OK\"} default button 1 with icon caution" >/dev/null 2>&1 || true
}

http_ok() { curl -sf --max-time 3 "$1" >/dev/null 2>&1; }

port_pid() { lsof -nP -iTCP:"$1" -sTCP:LISTEN -t 2>/dev/null | head -1; }

# Who is holding a port, in words a person recognises.
port_owner() {
  local pid
  pid="$(port_pid "$1")"
  [[ -z "$pid" ]] && { echo ""; return; }
  ps -o comm= -p "$pid" 2>/dev/null | sed 's#.*/##' || echo "pid $pid"
}

# Wait up to two minutes for the external drive.
wait_for_drive() {
  local waited=0
  while [[ ! -d "$BUDDY" || ! -d "$AGENT" ]]; do
    if (( waited == 0 )); then
      say "Waiting for the Agent drive…"
      dialog "Plug in the Agent drive, then run Preyas again."
    fi
    sleep 5
    waited=$((waited + 5))
    if (( waited >= 120 )); then
      say "Agent drive did not appear; stopping."
      return 1
    fi
  done
  say "Agent drive is mounted."
}

wait_for_drive || exit 1

say "Starting Preyas from $REPO_ROOT"
STARTED=()
started_count=0

# 1. llama-server on :8790
if http_ok "http://127.0.0.1:8790/health"; then
  say "llama-server already healthy on :8790."
else
  if [[ -n "$(port_pid 8790)" ]]; then
    say "Port 8790 is held by $(port_owner 8790); not touching it."
  elif [[ -x "$AGENT/bin/local-llm.sh" ]]; then
    say "Starting llama-server…"
    "$AGENT/bin/local-llm.sh" start >>"$LOGS/llama.log" 2>&1 || say "llama-server did not start; see $LOGS/llama.log"
    STARTED+=("llama"); started_count=$((started_count + 1))
  else
    say "No $AGENT/bin/local-llm.sh; starting through the brain instead."
  fi
fi

# 2. brain proxy on :8788 — the one we must be careful with.
if http_ok "http://127.0.0.1:8788/v1/health"; then
  say "brain proxy already healthy on :8788."
else
  holder="$(port_owner 8788)"
  if [[ -n "$holder" ]]; then
    say "Port 8788 is held by '$holder'. Refusing to kill it."
    dialog "Port 8788 is used by \"$holder\", not by Preyas. Quit that app (or restart your Mac), then open Preyas again."
  else
    say "Starting brain proxy…"
    (
      cd "$BRAIN"
      BAKUGAN_DATA_DIR="$BUDDY" AGENT_DRIVE_ROOT="$AGENT" BRAIN_PORT=8788 BRAIN_HOST=0.0.0.0 \
        nohup node --experimental-strip-types --disable-warning=ExperimentalWarning proxy.mjs \
        >>"$LOGS/preyas-proxy.log" 2>&1 &
      echo $! > "$LOGS/preyas-proxy.pid"
    )
    STARTED+=("proxy"); started_count=$((started_count + 1))
    for _ in $(seq 1 30); do http_ok "http://127.0.0.1:8788/v1/health" && break; sleep 1; done
  fi
fi

# 3. whisper on :8178 (optional: speech is a bonus).
if http_ok "http://127.0.0.1:8178/health" || [[ -n "$(port_pid 8178)" ]]; then
  say "whisper already listening on :8178."
else
  WHISPER_BIN="$BUDDY/tools/whisper/whisper-server"
  WHISPER_MODEL="$BUDDY/models/whisper/ggml-base.bin"
  if [[ -x "$WHISPER_BIN" && -f "$WHISPER_MODEL" ]]; then
    say "Starting whisper…"
    nohup "$WHISPER_BIN" -m "$WHISPER_MODEL" --host 127.0.0.1 --port 8178 >>"$LOGS/whisper.log" 2>&1 &
    STARTED+=("whisper"); started_count=$((started_count + 1))
  else
    say "whisper not installed; skipping voice."
  fi
fi

# 4. paid gateway on :4000 (optional; needs its own key on the drive).
if http_ok "http://127.0.0.1:4000/health/liveliness" || http_ok "http://127.0.0.1:4000/"; then
  say "gateway already healthy on :4000."
elif [[ -n "$(port_pid 4000)" ]]; then
  say "Port 4000 is held by $(port_owner 4000); leaving it."
elif [[ -f "$AGENT/secrets/.env" && -x "$GATEWAY" ]]; then
  say "Starting gateway…"
  nohup "$GATEWAY" >>"$LOGS/gateway.out" 2>&1 &
  STARTED+=("gateway"); started_count=$((started_count + 1))
else
  say "Gateway not configured on this drive; skipping."
fi

# 5. the web app on :8081 — the same thing `npm run web` serves.
if [[ -n "$(port_pid "$WEB_PORT")" ]]; then
  say "web app already listening on :$WEB_PORT."
elif [[ -d "$MOBILE/node_modules" ]]; then
  say "Starting the web app (first start can take a minute)…"
  (
    cd "$MOBILE"
    nohup npx expo start --web --non-interactive >>"$LOGS/expo.log" 2>&1 &
    echo $! > "$LOGS/preyas-web.pid"
  )
  STARTED+=("web"); started_count=$((started_count + 1))
  for _ in $(seq 1 60); do
    [[ -n "$(port_pid "$WEB_PORT")" ]] && break
    sleep 1
  done
else
  say "The web app has no node_modules yet; run npm install in apps/mobile."
fi

if (( started_count == 0 )); then
  say "Nothing to start; everything was already up."
else
  say "Started: ${STARTED[*]}"
fi

URL="http://localhost:$WEB_PORT"
say "Preyas is at $URL"
if (( OPEN_BROWSER )); then
  open "$URL" >/dev/null 2>&1 || true
fi
