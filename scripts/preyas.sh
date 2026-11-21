#!/usr/bin/env bash
# Preyas controller: one script for ON, OFF, RESTART and STATUS.
#
# Services start in this order, each one only after the one before is healthy:
#   llama-server :8790 -> LiteLLM :4000 -> kiwix-serve :8791 (only with packs)
#   -> brain-server :8788 -> Expo web :8081
#
# PID files and logs live in /Volumes/Agent/agent/logs/preyas/.
# Safe to run twice: a healthy service is never started twice, and an unrelated
# app holding one of our ports is never killed.
#
#   scripts/preyas.sh start
#   scripts/preyas.sh stop
#   scripts/preyas.sh restart
#   scripts/preyas.sh restart model
#   scripts/preyas.sh status
#   scripts/preyas.sh status --json
#   scripts/preyas.sh autostart on|off|status [--json]
#
# Every slow or machine-specific piece is a function so scripts/preyas.test.sh
# can replace it and exercise the logic with mock processes.
set -uo pipefail

# launchd starts with a very small PATH; node, npx and llama-server may live
# outside it. Keep the user's usual places first.
export PATH="${HOME}/.local/bin:/opt/homebrew/bin:/usr/local/bin:${PATH:-/usr/bin:/bin}"

REPO_ROOT="${PREYAS_REPO_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
BUDDY_DIR="${PREYAS_BUDDY_DIR:-$REPO_ROOT/bakugan-buddy}"
BUDDY_DATA="${PREYAS_BUDDY_DATA:-/Volumes/Agent/BakuganBuddy}"
AGENT_DIR="${PREYAS_AGENT_DIR:-/Volumes/Agent/agent}"
LOG_DIR="${PREYAS_LOG_DIR:-$AGENT_DIR/logs/preyas}"
MOBILE_DIR="${PREYAS_MOBILE_DIR:-$BUDDY_DIR/apps/mobile}"
BRAIN_DIR="${PREYAS_BRAIN_DIR:-$BUDDY_DIR/brain-server}"
GATEWAY_SH="${PREYAS_GATEWAY_SH:-$REPO_ROOT/tools/agent-drive/gateway/start.sh}"
LLAMA_LAUNCHER="${PREYAS_LLAMA_LAUNCHER:-$AGENT_DIR/bin/local-llm.sh}"
ZIM_DIR="${PREYAS_ZIM_DIR:-$AGENT_DIR/knowledge/zim}"
WEB_PORT="${PREYAS_WEB_PORT:-8081}"
BRAIN_HOST="${PREYAS_BRAIN_HOST:-0.0.0.0}"
LAUNCH_AGENTS_DIR="${PREYAS_LAUNCH_AGENTS_DIR:-$HOME/Library/LaunchAgents}"
AUTOSTART_LABEL="com.preyas.control"
AUTOSTART_PLIST="$LAUNCH_AGENTS_DIR/$AUTOSTART_LABEL.plist"

SERVICES=(llama litellm kiwix brain web)
STOP_ORDER=(web brain kiwix litellm llama)

say() { printf '%s\n' "$*"; }
now_iso() { date -u '+%Y-%m-%dT%H:%M:%SZ'; }

ensure_dirs() {
  mkdir -p "$LOG_DIR" 2>/dev/null || true
}

log() {
  ensure_dirs
  printf '%s %s\n' "$(now_iso)" "$*" >>"$LOG_DIR/control.log" 2>/dev/null || true
}

pidfile_for() { printf '%s/%s.pid\n' "$LOG_DIR" "$1"; }
log_for() { printf '%s/%s.log\n' "$LOG_DIR" "$1"; }

svc_label() {
  case "$1" in
    llama) echo "llama-server" ;;
    litellm) echo "LiteLLM" ;;
    kiwix) echo "kiwix-serve" ;;
    brain) echo "brain-server" ;;
    web) echo "Expo web" ;;
    *) echo "$1" ;;
  esac
}

svc_port() {
  case "$1" in
    llama) echo 8790 ;;
    litellm) echo 4000 ;;
    kiwix) echo 8791 ;;
    brain) echo 8788 ;;
    web) echo "$WEB_PORT" ;;
    *) echo 0 ;;
  esac
}

svc_health_url() {
  case "$1" in
    llama) echo "http://127.0.0.1:8790/health" ;;
    litellm) echo "http://127.0.0.1:4000/health/liveliness" ;;
    kiwix) echo "http://127.0.0.1:8791/" ;;
    brain) echo "http://127.0.0.1:8788/v1/health" ;;
    web) echo "http://127.0.0.1:${WEB_PORT}/" ;;
    *) echo "" ;;
  esac
}

svc_health_mode() {
  case "$1" in
    llama|litellm|brain) echo "ok" ;;
    kiwix) echo "any" ;;
    web) echo "preyas" ;;
    *) echo "ok" ;;
  esac
}

svc_seconds() {
  case "$1" in
    llama) echo 180 ;;
    litellm) echo 120 ;;
    kiwix) echo 30 ;;
    brain) echo 90 ;;
    web) echo 180 ;;
    *) echo 60 ;;
  esac
}

svc_required() {
  case "$1" in
    llama|brain|web) return 0 ;;
    *) return 1 ;;
  esac
}

is_mac() { [[ "$(uname -s 2>/dev/null)" == "Darwin" ]]; }

pid_alive() {
  [[ "${1:-}" =~ ^[0-9]+$ ]] && kill -0 "$1" 2>/dev/null
}

read_pidfile() {
  local file="$1"
  [[ -f "$file" ]] || return 0
  local value
  value="$(cat "$file" 2>/dev/null | tr -d '[:space:]')"
  [[ "$value" =~ ^[0-9]+$ ]] && printf '%s\n' "$value"
}

port_pid() {
  local port="$1"
  lsof -nP -iTCP:"$port" -sTCP:LISTEN -t 2>/dev/null | head -1
}

child_pids() {
  pgrep -P "$1" 2>/dev/null || true
}

pid_matches() {
  local pid="$1" pattern="$2" line
  line="$(ps -p "$pid" -o command= 2>/dev/null || true)"
  [[ -n "$line" ]] || return 1
  printf '%s' "$line" | grep -qi "$pattern"
}

http_ok() {
  curl -fsS --max-time 1 "$1" >/dev/null 2>&1
}

http_any() {
  curl -sS -o /dev/null --max-time 1 "$1" >/dev/null 2>&1
}

http_preyas() {
  curl -fsS --max-time 1 "$1" 2>/dev/null | grep -qi "preyas"
}

health_ok() {
  local name="$1" url mode
  url="$(svc_health_url "$name")"
  mode="$(svc_health_mode "$name")"
  [[ -n "$url" ]] || return 1
  case "$mode" in
    any) http_any "$url" ;;
    preyas) http_preyas "$url" ;;
    *) http_ok "$url" ;;
  esac
}

zim_files() {
  local file
  for file in "$ZIM_DIR"/*.zim; do
    [[ -f "$file" ]] && printf '%s\n' "$file"
  done
}

zim_count() { zim_files | wc -l | tr -d '[:space:]'; }

kiwix_path() {
  if [[ -n "${PREYAS_KIWIX_BIN:-}" && -x "${PREYAS_KIWIX_BIN:-}" ]]; then
    printf '%s\n' "$PREYAS_KIWIX_BIN"
    return
  fi
  if [[ -x "$AGENT_DIR/bin/kiwix-serve" ]]; then
    printf '%s\n' "$AGENT_DIR/bin/kiwix-serve"
    return
  fi
  command -v kiwix-serve 2>/dev/null || true
}

secret_key_present() {
  local key="$1" file="$AGENT_DIR/secrets/.env"
  [[ -f "$file" ]] || return 1
  grep -Eq "^${key}=.+" "$file" 2>/dev/null || return 1
  grep -Eq "^${key}=(changeme|\"\"|'')?$" "$file" 2>/dev/null && return 1
  return 0
}

service_available() {
  case "$1" in
    llama) [[ -x "$LLAMA_LAUNCHER" ]] ;;
    litellm) [[ -x "$GATEWAY_SH" && -x "$AGENT_DIR/venv/bin/litellm" ]] && secret_key_present DEEPSEEK_API_KEY ;;
    kiwix) [[ "$(zim_count)" -gt 0 ]] && [[ -n "$(kiwix_path)" ]] ;;
    brain) [[ -f "$BRAIN_DIR/proxy.mjs" ]] && command -v node >/dev/null 2>&1 ;;
    web) [[ -d "$MOBILE_DIR/node_modules" ]] && command -v npx >/dev/null 2>&1 ;;
    *) return 1 ;;
  esac
}

service_unavailable_detail() {
  case "$1" in
    llama) echo "launcher not found" ;;
    litellm) echo "gateway or key not set up" ;;
    kiwix) echo "no offline packs or kiwix-serve" ;;
    brain) echo "brain files missing" ;;
    web) echo "run npm install first" ;;
    *) echo "not available" ;;
  esac
}

service_expected_pattern() {
  case "$1" in
    llama) echo "llama-server" ;;
    litellm) echo "litellm" ;;
    kiwix) echo "kiwix-serve" ;;
    brain) echo "proxy\\.mjs" ;;
    web) echo "expo" ;;
    *) echo "" ;;
  esac
}

# Append each service PID once, so status and stop always agree.
service_pids() {
  local name="$1" pattern file pid port seen
  pattern="$(service_expected_pattern "$name")"
  seen=" "
  emit_pid() {
    local candidate="$1"
    [[ -n "$candidate" ]] || return 0
    [[ "$seen" == *" $candidate "* ]] && return 0
    seen="$seen$candidate "
    printf '%s\n' "$candidate"
  }

  file="$(pidfile_for "$name")"
  pid="$(read_pidfile "$file")"
  if [[ -n "$pid" ]] && pid_alive "$pid" && pid_matches "$pid" "$pattern"; then
    emit_pid "$pid"
  fi

  if [[ "$name" == "llama" ]]; then
    pid="$(read_pidfile "$AGENT_DIR/logs/local-llm.pid")"
    if [[ -n "$pid" ]] && pid_alive "$pid" && pid_matches "$pid" "$pattern"; then
      emit_pid "$pid"
    fi
  fi

  port="$(port_pid "$(svc_port "$name")")"
  if [[ -n "$port" ]] && pid_matches "$port" "$pattern"; then
    emit_pid "$port"
  fi
}

ram_kb_of_pid() {
  local pid="$1" kb
  kb="$(ps -p "$pid" -o rss= 2>/dev/null | tr -d '[:space:]' | head -1)"
  [[ "$kb" =~ ^[0-9]+$ ]] && printf '%s\n' "$kb"
}

ram_mb() {
  local pid="$1" total=0 kb child
  [[ "${pid:-}" =~ ^[0-9]+$ ]] || { echo 0; return; }
  kb="$(ram_kb_of_pid "$pid")"
  [[ -n "$kb" ]] && total=$((total + kb))
  for child in $(child_pids "$pid"); do
    kb="$(ram_kb_of_pid "$child")"
    [[ -n "$kb" ]] && total=$((total + kb))
  done
  echo $((total / 1024))
}

human_ram() {
  local mb="${1:-0}"
  if (( mb >= 1024 )); then
    awk -v mb="$mb" 'BEGIN { printf "%.1f GB", mb / 1024 }'
  else
    printf '%s MB\n' "$mb"
  fi
}

wait_health() {
  local name="$1" seconds="$2" tries i
  tries=$((seconds * 2))
  for ((i = 0; i < tries; i++)); do
    health_ok "$name" && return 0
    sleep 0.5
  done
  return 1
}

kill_tree() {
  local pid="$1" signal="$2" child
  for child in $(child_pids "$pid"); do
    kill_tree "$child" "$signal"
  done
  kill "-$signal" "$pid" 2>/dev/null || true
}

launch_service() {
  local name="$1" file logfile
  file="$(pidfile_for "$name")"
  logfile="$(log_for "$name")"

  case "$name" in
    llama)
      "$LLAMA_LAUNCHER" start >>"$logfile" 2>&1 </dev/null
      local llama_pidfile="$AGENT_DIR/logs/local-llm.pid"
      if [[ -f "$llama_pidfile" ]]; then
        cat "$llama_pidfile" >"$file" 2>/dev/null || true
      fi
      ;;
    litellm)
      (
        nohup "$GATEWAY_SH" >>"$logfile" 2>&1 </dev/null &
        echo $! >"$file"
      )
      ;;
    kiwix)
      local bin
      bin="$(kiwix_path)"
      local -a zims=()
      while IFS= read -r zim; do zims+=("$zim"); done < <(zim_files)
      (
        nohup "$bin" --address 127.0.0.1 --port 8791 ${zims[@]+"${zims[@]}"} >>"$logfile" 2>&1 </dev/null &
        echo $! >"$file"
      )
      ;;
    brain)
      (
        cd "$BRAIN_DIR" || exit 1
        BAKUGAN_DATA_DIR="$BUDDY_DATA" \
          AGENT_DRIVE_ROOT="$AGENT_DIR" \
          BRAIN_PORT=8788 \
          BRAIN_HOST="$BRAIN_HOST" \
          LLAMA_URL="http://127.0.0.1:8790" \
          nohup node --experimental-strip-types --disable-warning=ExperimentalWarning proxy.mjs >>"$logfile" 2>&1 </dev/null &
        echo $! >"$file"
      )
      ;;
    web)
      (
        cd "$MOBILE_DIR" || exit 1
        EXPO_PACKAGER_PROXY_URL="" nohup npx expo start --web --non-interactive --host lan --port "$WEB_PORT" >>"$logfile" 2>&1 </dev/null &
        echo $! >"$file"
      )
      ;;
    *)
      return 1
      ;;
  esac
}

start_service() {
  local name="$1" label holder pid owner
  label="$(svc_label "$name")"

  if health_ok "$name"; then
    say "$label is already running."
    return 0
  fi

  if ! service_available "$name"; then
    say "$label is skipped: $(service_unavailable_detail "$name")."
    if svc_required "$name"; then
      return 1
    fi
    return 0
  fi

  holder="$(port_pid "$(svc_port "$name")")"
  if [[ -n "$holder" ]]; then
    if pid_matches "$holder" "$(service_expected_pattern "$name")"; then
      say "Port $(svc_port "$name") is held by $label (pid $holder) but it is not answering; restarting it."
      stop_service "$name" >/dev/null 2>&1
      if [[ -n "$(port_pid "$(svc_port "$name")")" ]]; then
        say "Port $(svc_port "$name") did not free up; leaving it alone."
        return 1
      fi
    else
      owner="$(ps -p "$holder" -o comm= 2>/dev/null | sed 's#.*/##')"
      say "Port $(svc_port "$name") is used by ${owner:-another app}; leaving it alone."
      return 1
    fi
  fi

  say "Starting $label..."
  log "start $name"
  if ! launch_service "$name"; then
    say "$label did not start. See $(log_for "$name")."
    return 1
  fi

  if ! wait_health "$name" "$(svc_seconds "$name")"; then
    say "$label did not answer in time. See $(log_for "$name")."
    return 1
  fi

  pid="$(service_pids "$name" | head -1)"
  if [[ -n "$pid" ]]; then
    say "$label is up (pid $pid, port $(svc_port "$name"))."
  else
    say "$label is up (port $(svc_port "$name"))."
  fi
  return 0
}

start_all() {
  ensure_dirs
  log "start requested"
  local name
  for name in "${SERVICES[@]}"; do
    if ! start_service "$name"; then
      say "Stopped at $name. Nothing after it was started."
      return 1
    fi
  done
  say "Preyas is on. Open http://localhost:${WEB_PORT}"
  return 0
}

stop_service() {
  local name="$1" label pids pid waited
  label="$(svc_label "$name")"
  pids="$(service_pids "$name")"

  if [[ -z "$pids" ]]; then
    rm -f "$(pidfile_for "$name")"
    say "$label is not running."
    return 0
  fi

  say "Stopping $label..."
  log "stop $name"
  for pid in $pids; do
    kill_tree "$pid" TERM
  done

  waited=0
  while ((waited < 5000)); do
    pids="$(service_pids "$name")"
    [[ -z "$pids" ]] && break
    sleep 0.5
    waited=$((waited + 500))
  done

  pids="$(service_pids "$name")"
  if [[ -n "$pids" ]]; then
    say "$label ignored the polite stop; forcing it."
    for pid in $pids; do
      kill_tree "$pid" KILL
    done
    sleep 0.2
  fi

  rm -f "$(pidfile_for "$name")"
  if [[ -n "$(port_pid "$(svc_port "$name")")" ]]; then
    say "Port $(svc_port "$name") is still held by another app; left it alone."
    return 1
  fi
  say "$label stopped."
  return 0
}

stop_all() {
  ensure_dirs
  log "stop requested"
  local name failed=0
  for name in "${STOP_ORDER[@]}"; do
    stop_service "$name" || failed=1
  done
  if ((failed == 0)); then
    say "Preyas is off. RAM is free."
  else
    say "Preyas is mostly off; one port is still busy (see above)."
  fi
  return "$failed"
}

restart_one() {
  local name="$1" target="$1"
  case "$name" in
    model|llama) target="llama" ;;
    gateway|litellm) target="litellm" ;;
    offline|kiwix) target="kiwix" ;;
    brain|proxy|brain-server) target="brain" ;;
    web|expo|app) target="web" ;;
    *) return 2 ;;
  esac
  stop_service "$target" || true
  start_service "$target"
}

restart_all() {
  local target="${1:-all}"
  if [[ "$target" == "all" ]]; then
    stop_all
    start_all
    return $?
  fi
  if ! restart_one "$target"; then
    say "Unknown service: $target. Use llama|model, litellm, kiwix, brain or web."
    return 2
  fi
}

status_pid() {
  local name="$1"
  service_pids "$name" | head -1
}

status_detail() {
  local name="$1" pid="$2" healthy="${3:-false}"
  if [[ -n "$pid" ]]; then
    echo "running"
  elif [[ "$healthy" == "true" ]]; then
    echo "running (external)"
  elif service_available "$name"; then
    echo "stopped"
  else
    service_unavailable_detail "$name"
  fi
}

status_human() {
  ensure_dirs
  local name pid state ram
  for name in "${SERVICES[@]}"; do
    pid="$(status_pid "$name")"
    if [[ -n "$pid" ]] || health_ok "$name"; then
      state="running"
      if [[ -n "$pid" ]]; then ram="$(ram_mb "$pid")"; else ram=0; fi
    else
      state="stopped"
      ram=0
    fi
    printf '%-14s %-8s :%-5s %s\n' "$(svc_label "$name")" "$state" "$(svc_port "$name")" "$(human_ram "$ram")"
  done
}

status_json() {
  ensure_dirs
  local name pid running health ram first=1 detail available autostart
  if [[ -f "$AUTOSTART_PLIST" ]]; then autostart=true; else autostart=false; fi
  printf '{"ok":true,"checkedAt":"%s","services":[' "$(now_iso)"
  for name in "${SERVICES[@]}"; do
    pid="$(status_pid "$name")"
    health=false
    health_ok "$name" && health=true
    if [[ -n "$pid" ]] || [[ "$health" == "true" ]]; then running=true; else running=false; fi
    if [[ -n "$pid" ]]; then ram="$(ram_mb "$pid")"; else ram=0; fi
    if service_available "$name"; then available=true; else available=false; fi
    detail="$(status_detail "$name" "$pid" "$health")"
    ((first == 0)) && printf ','
    first=0
    printf '{"name":"%s","label":"%s","port":%s,"running":%s,"health":%s,"pid":%s,"ramMb":%s,"available":%s,"detail":"%s"}' \
      "$name" "$(svc_label "$name")" "$(svc_port "$name")" "$running" "$health" \
      "${pid:-null}" "$ram" "$available" "$detail"
  done
  printf '],"autostart":{"installed":%s,"supported":%s,"path":"%s"}}\n' \
    "$autostart" "$(is_mac && echo true || echo false)" "$AUTOSTART_PLIST"
}

plist_escape() {
  local value="$1"
  value="${value//&/&amp;}"
  value="${value//</&lt;}"
  value="${value//>/&gt;}"
  printf '%s' "$value"
}

write_plist() {
  local script repo out
  script="$(plist_escape "$REPO_ROOT/scripts/preyas.sh")"
  repo="$(plist_escape "$REPO_ROOT")"
  out="$(plist_escape "$LOG_DIR/autostart.log")"
  mkdir -p "$LAUNCH_AGENTS_DIR" 2>/dev/null || true
  cat >"$AUTOSTART_PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${AUTOSTART_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>${script}</string>
    <string>start</string>
  </array>
  <key>WorkingDirectory</key>
  <string>${repo}</string>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <false/>
  <key>StandardOutPath</key>
  <string>${out}</string>
  <key>StandardErrorPath</key>
  <string>${out}</string>
</dict>
</plist>
PLIST
}

autostart_status() {
  local installed=false
  [[ -f "$AUTOSTART_PLIST" ]] && installed=true
  if [[ "${1:-}" == "--json" ]]; then
    printf '{"installed":%s,"supported":%s,"path":"%s"}\n' \
      "$installed" "$(is_mac && echo true || echo false)" "$AUTOSTART_PLIST"
  else
    if [[ "$installed" == "true" ]]; then
      say "Auto-start on login is ON."
    else
      say "Auto-start on login is OFF."
    fi
  fi
}

autostart_on() {
  ensure_dirs
  write_plist
  if is_mac && command -v launchctl >/dev/null 2>&1; then
    launchctl unload "$AUTOSTART_PLIST" >/dev/null 2>&1 || true
    launchctl load -w "$AUTOSTART_PLIST" >/dev/null 2>&1 || true
  fi
  say "Auto-start on login is ON."
  log "autostart on"
}

autostart_off() {
  if is_mac && command -v launchctl >/dev/null 2>&1; then
    launchctl unload "$AUTOSTART_PLIST" >/dev/null 2>&1 || true
  fi
  rm -f "$AUTOSTART_PLIST"
  say "Auto-start on login is OFF."
  log "autostart off"
}

autostart_command() {
  local action="${1:-status}" json="${2:-}"
  case "$action" in
    on) autostart_on ;;
    off) autostart_off ;;
    status) autostart_status "$json" ;;
    *)
      say "Use: scripts/preyas.sh autostart on|off|status"
      return 2
      ;;
  esac
}

usage() {
  cat <<'USAGE'
Use: scripts/preyas.sh <command>

  start              turn everything on (skips what is already running)
  stop               turn everything off (SIGTERM, then SIGKILL after 5s)
  restart            turn everything off, then on
  restart <service>  restart one: llama|model, litellm, kiwix, brain, web
  status             one line per service: state, port, RAM
  status --json      the same, for the app
  autostart on|off|status [--json]
                     start Preyas when you log in (off by default)

Logs and PID files: /Volumes/Agent/agent/logs/preyas/
USAGE
}

main() {
  local command="${1:-status}"
  shift 2>/dev/null || true
  case "$command" in
    start) start_all ;;
    stop) stop_all ;;
    restart) restart_all "${1:-all}" ;;
    status)
      if [[ "${1:-}" == "--json" ]]; then status_json; else status_human; fi
      ;;
    autostart) autostart_command "${1:-status}" "${2:-}" ;;
    help|-h|--help) usage ;;
    *)
      usage
      return 2
      ;;
  esac
}

# Tests source this file with PREYAS_TEST_LIB pointing at their fake world.
if [[ -n "${PREYAS_TEST_LIB:-}" && -f "${PREYAS_TEST_LIB}" ]]; then
  # shellcheck disable=SC1090
  source "$PREYAS_TEST_LIB"
fi

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  main "$@"
fi
