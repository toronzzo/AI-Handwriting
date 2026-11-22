#!/usr/bin/env bash
# Tests for scripts/preyas.sh with mock processes. No real service is touched.
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TMP="$(mktemp -d "${TMPDIR:-/tmp}/preyas-test.XXXXXX")"
cleanup() { rm -rf "$TMP"; }
trap cleanup EXIT

export PREYAS_REPO_ROOT="$ROOT"
export PREYAS_BUDDY_DIR="$TMP/buddy"
export PREYAS_BUDDY_DATA="$TMP/buddy-data"
export PREYAS_AGENT_DIR="$TMP/agent"
export PREYAS_LOG_DIR="$TMP/logs"
export PREYAS_MOBILE_DIR="$TMP/buddy/apps/mobile"
export PREYAS_BRAIN_DIR="$TMP/buddy/brain-server"
export PREYAS_GATEWAY_SH="$TMP/gateway.sh"
export PREYAS_LLAMA_LAUNCHER="$TMP/llama.sh"
export PREYAS_ZIM_DIR="$TMP/zim"
export PREYAS_KIWIX_BIN="$TMP/kiwix-serve"
export PREYAS_LAUNCH_AGENTS_DIR="$TMP/LaunchAgents"
export PREYAS_WEB_PORT=8081
export PREYAS_MOCK_STATE="$TMP/mock"
export PREYAS_TEST_LIB="$TMP/mock.sh"

mkdir -p "$PREYAS_AGENT_DIR/bin" "$PREYAS_AGENT_DIR/venv/bin" "$PREYAS_AGENT_DIR/secrets"
mkdir -p "$PREYAS_ZIM_DIR" "$PREYAS_MOBILE_DIR/node_modules" "$PREYAS_BRAIN_DIR"
: >"$PREYAS_GATEWAY_SH"; chmod +x "$PREYAS_GATEWAY_SH"
: >"$PREYAS_LLAMA_LAUNCHER"; chmod +x "$PREYAS_LLAMA_LAUNCHER"
: >"$PREYAS_AGENT_DIR/venv/bin/litellm"; chmod +x "$PREYAS_AGENT_DIR/venv/bin/litellm"
: >"$PREYAS_KIWIX_BIN"; chmod +x "$PREYAS_KIWIX_BIN"
: >"$PREYAS_ZIM_DIR/wiki.zim"
: >"$PREYAS_BRAIN_DIR/proxy.mjs"
printf 'DEEPSEEK_API_KEY=sk-test\n' >"$PREYAS_AGENT_DIR/secrets/.env"

cat >"$PREYAS_TEST_LIB" <<'MOCK'
STATE="$PREYAS_MOCK_STATE"

event() { printf '%s\n' "$*" >>"$STATE/events"; }

reset_world() {
  rm -rf "$STATE"
  mkdir -p "$STATE/alive" "$STATE/health" "$STATE/pidof" "$STATE/port" "$STATE/cmd" "$STATE/env" "$STATE/health-only-port"
  : >"$STATE/events"
}

alive_pid() { : >"$STATE/alive/$1"; }
dead_pid() { rm -f "$STATE/alive/$1"; }
healthy() { : >"$STATE/health/$1"; }
unhealthy() { rm -f "$STATE/health/$1"; }
set_pid() {
  alive_pid "$1"
  printf '%s\n' "$1" >"$STATE/pidof/$2"
}
clear_pid() { rm -f "$STATE/pidof/$2" "$STATE/alive/$1"; }

# Every machine-specific probe is replaced here.
now_iso() { printf '2026-11-21T00:00:00Z\n'; }
sleep() { :; }
pid_alive() { [[ -f "$STATE/alive/${1:-}" ]]; }
port_pid() { [[ -f "$STATE/port/$1" ]] && cat "$STATE/port/$1"; }
child_pids() { :; }
pid_matches() {
  local pid="$1" pattern="$2"
  if [[ -f "$STATE/cmd/$pid" ]]; then
    grep -qi "$pattern" "$STATE/cmd/$pid"
    return
  fi
  return 0
}
process_name() {
  if [[ -f "$STATE/cmd/$1" ]]; then
    awk '{print $1}' "$STATE/cmd/$1"
    return
  fi
  printf 'app\n'
}
process_env_var() {
  [[ -f "$STATE/env/${1:-}/${2:-}" ]] && cat "$STATE/env/${1:-}/${2:-}"
}
health_ok() {
  local name="$1"
  if [[ -f "$STATE/health-only-port/$name" ]]; then
    [[ "$(cat "$STATE/health-only-port/$name")" == "$(svc_port "$name")" ]] || return 1
  fi
  [[ -f "$STATE/health/$name" ]]
}
service_pids() {
  local pid
  [[ -f "$STATE/pidof/$1" ]] || return 0
  pid="$(cat "$STATE/pidof/$1")"
  [[ -f "$STATE/alive/$pid" ]] || return 0
  pid_matches "$pid" "$(service_expected_pattern "$1")" || return 0
  printf '%s\n' "$pid"
}
kill_tree() {
  local pid="$1" signal="$2"
  event "signal $signal $pid"
  if [[ "$signal" == "KILL" ]]; then rm -f "$STATE/alive/$pid"; fi
}
ram_mb() { printf '512\n'; }
launch_service() {
  local name="$1" pid
  event "launch $name webport=${WEB_PORT}"
  case "$name" in
    llama) pid=4101 ;;
    litellm) pid=4102 ;;
    kiwix) pid=4103 ;;
    brain) pid=4104 ;;
    web) pid=4105 ;;
    *) pid=4199 ;;
  esac
  set_pid "$pid" "$name"
  healthy "$name"
  if [[ "$name" == "brain" ]]; then
    mkdir -p "$STATE/env/$pid"
    printf '%s\n' "$WEB_PORT" >"$STATE/env/$pid/PREYAS_WEB_PORT"
  fi
}
is_mac() { return 1; }
launchctl() { :; }
MOCK

# shellcheck source=scripts/preyas.sh
source "$ROOT/scripts/preyas.sh"

pass=0
fail=0
ok() { pass=$((pass + 1)); printf 'ok - %s\n' "$1"; }
not_ok() { fail=$((fail + 1)); printf 'not ok - %s\n' "$1"; }
assert_eq() {
  local label="$1" got="$2" want="$3"
  if [[ "$got" == "$want" ]]; then ok "$label"; else
    not_ok "$label"
    printf '  want: %q\n  got:  %q\n' "$want" "$got"
  fi
}
assert_contains() {
  local label="$1" haystack="$2" needle="$3"
  if [[ "$haystack" == *"$needle"* ]]; then ok "$label"; else
    not_ok "$label"
    printf '  missing: %q\n  in:      %q\n' "$needle" "$haystack"
  fi
}
events() { cat "$STATE/events"; }

# ---------------------------------------------------------------- start order
reset_world
start_all >/dev/null 2>&1
assert_eq "start: every service is launched in order" "$(events | grep '^launch ' | sed 's/ webport=.*//' | tr '\n' ' ')" "launch llama launch litellm launch kiwix launch brain launch web "
assert_eq "start: all services healthy" "$(events | grep -c '^launch ')" "5"

# ------------------------------------------------------- skip already running
reset_world
healthy litellm
start_all >/dev/null 2>&1
assert_eq "start: a healthy service is not started twice" "$(events | grep -c '^launch litellm ')" "0"
assert_eq "start: the rest still start" "$(events | grep -c '^launch ')" "4"

# --------------------------------------------------- kiwix only when packs exist
reset_world
rm -f "$PREYAS_ZIM_DIR"/*.zim
if service_available kiwix; then not_ok "kiwix: no packs means skipped"; else ok "kiwix: no packs means skipped"; fi
: >"$PREYAS_ZIM_DIR/wiki.zim"
if service_available kiwix; then ok "kiwix: packs and binary means available"; else not_ok "kiwix: packs and binary means available"; fi
reset_world
rm -f "$PREYAS_ZIM_DIR"/*.zim
start_all >/dev/null 2>&1
assert_eq "start: kiwix is not launched without packs" "$(events | grep -c '^launch kiwix ')" "0"
: >"$PREYAS_ZIM_DIR/wiki.zim"

# ---------------------------------------------------- stop sends TERM then KILL
reset_world
set_pid 4201 llama
stop_service llama >/dev/null 2>&1
sig="$(events | grep '^signal ' | tr '\n' ' ')"
assert_eq "stop: SIGTERM first, SIGKILL after 5s" "$sig" "signal TERM 4201 signal KILL 4201 "
if [[ -f "$(pidfile_for llama)" ]]; then not_ok "stop: pid file is removed"; else ok "stop: pid file is removed"; fi
dead_pid 4201

# ------------------------------------------------------------- status output
reset_world
set_pid 4301 llama
out="$(status_human)"
assert_contains "status: line says running" "$out" "llama-server"
assert_contains "status: line says running" "$out" "running"
assert_contains "status: port is shown" "$out" ":8790"
assert_contains "status: RAM is shown" "$out" "512 MB"

json="$(status_json)"
node -e 'const j=JSON.parse(process.argv[1]); if(!Array.isArray(j.services)||j.services.length!==5) process.exit(1); if(j.services[0].name!=="llama"||j.services[0].running!==true||j.services[0].ramMb!==512) process.exit(2); if(j.autostart.installed!==false) process.exit(3);' "$json"
assert_eq "status --json: valid shape, service and autostart fields" "$?" "0"

# -------------------------------------------------------------- restart order
reset_world
for name in llama litellm kiwix brain web; do
  case "$name" in
    llama) set_pid 4401 llama ;;
    litellm) set_pid 4402 litellm ;;
    kiwix) set_pid 4403 kiwix ;;
    brain) set_pid 4404 brain ;;
    web) set_pid 4405 web ;;
  esac
done
restart_all all >/dev/null 2>&1
term_order="$(events | grep '^signal TERM ' | sed 's/^signal TERM //' | tr '\n' ' ')"
assert_eq "restart: stops web, brain, kiwix, LiteLLM, llama" "$term_order" "4405 4404 4403 4402 4401 "
launch_order="$(events | grep '^launch ' | sed 's/^launch //; s/ webport=.*//' | tr '\n' ' ')"
assert_eq "restart: starts in the normal order" "$launch_order" "llama litellm kiwix brain web "

# --------------------------------------------------------- restart one service
reset_world
set_pid 4501 llama
set_pid 4504 brain
restart_one brain >/dev/null 2>&1
assert_eq "restart brain: stops brain" "$(events | grep -c '^signal TERM 4504$')" "1"
assert_eq "restart brain: starts brain" "$(events | grep -c '^launch brain ')" "1"
assert_eq "restart brain: leaves llama alone" "$(events | grep -c '4501')" "0"
if restart_one model >/dev/null 2>&1; then ok "restart model: maps to llama"; else not_ok "restart model: maps to llama"; fi

# ------------------------------------------------------------------ autostart
reset_world
autostart_status --json >"$TMP/auto.json"
node -e 'const j=require(process.argv[1]); if(j.installed!==false||j.supported!==false) process.exit(1);' "$TMP/auto.json"
assert_eq "autostart: OFF by default" "$?" "0"
autostart_on >/dev/null 2>&1
autostart_status --json >"$TMP/auto-on.json"
node -e 'const j=require(process.argv[1]); if(j.installed!==true) process.exit(1);' "$TMP/auto-on.json"
assert_eq "autostart: on writes the plist" "$?" "0"
grep -q "preyas.sh" "$AUTOSTART_PLIST"
assert_eq "autostart: plist points at the controller" "$?" "0"
autostart_off >/dev/null 2>&1
if [[ -f "$AUTOSTART_PLIST" ]]; then not_ok "autostart: off removes the plist"; else ok "autostart: off removes the plist"; fi

# ------------------------------------------- a recycled pid is never signalled
reset_world
set_pid 4601 llama
printf '4601\n' >"$(pidfile_for llama)"
pid_matches() { return 1; }
assert_eq "safety: a pid that is not ours is ignored" "$(status_pid llama)" ""
pid_matches() {
  local pid="$1" pattern="$2"
  if [[ -f "$STATE/cmd/$pid" ]]; then
    grep -qi "$pattern" "$STATE/cmd/$pid"
    return
  fi
  return 0
}

# ---------------------------------------------------- stop one service only
reset_world
set_pid 4701 llama
set_pid 4702 litellm
set_pid 4705 web
out="$(main stop litellm)"
assert_eq "stop litellm: signals only litellm" "$(events | grep -c '^signal TERM 4702$')" "1"
assert_eq "stop litellm: does not signal llama" "$(events | grep -c '4701')" "0"
assert_eq "stop litellm: does not signal web" "$(events | grep -c '4705')" "0"
assert_contains "stop litellm: says it stopped that service" "$out" "LiteLLM stopped."
assert_eq "stop litellm: does not claim everything is off" "$(printf '%s' "$out" | grep -c 'Preyas is off')" "0"

reset_world
set_pid 4711 llama
out="$(main stop nope 2>&1 || true)"
assert_contains "stop unknown: explains the names" "$out" "Unknown service"
assert_eq "stop unknown: does not signal anyone" "$(events | grep -c '^signal ')" "0"

# -------------------------------- foreign listener is not "already running"
reset_world
printf '2605\n' >"$STATE/port/8081"
printf 'Cursor\n' >"$STATE/cmd/2605"
alive_pid 2605
out="$(start_all)"
assert_contains "foreign port: says who holds it" "$out" "Port 8081 is used by Cursor, not Expo web."
assert_contains "foreign port: names the free port" "$out" "port 8082"
assert_contains "foreign port: prints the page to open" "$out" "http://localhost:8082"
assert_eq "foreign port: Expo is launched on the free port" "$(events | grep -c '^launch web webport=8082$')" "1"
assert_eq "foreign port: the brain is told that port" "$(events | grep -c '^launch brain webport=8082$')" "1"
assert_eq "foreign port: Cursor is not signalled" "$(events | grep -c '2605')" "0"
assert_eq "foreign port: the choice is remembered" "$(cat "$PREYAS_LOG_DIR/web.port")" "8082"

# A health response on the editor's port is still not Expo.
reset_world
WEB_PORT="$PREFERRED_WEB_PORT"
export PREYAS_WEB_PORT="$WEB_PORT"
printf '2605\n' >"$STATE/port/8081"
printf 'Cursor\n' >"$STATE/cmd/2605"
healthy web
printf '8081\n' >"$STATE/health-only-port/web"
out="$(start_service web)"
assert_eq "foreign health: Expo still starts on the next port" "$(events | grep -c '^launch web webport=8082$')" "1"
assert_eq "foreign health: not treated as already running" "$(printf '%s' "$out" | grep -c 'already running')" "0"

# Our own Expo on the preferred port is left alone.
reset_world
WEB_PORT="$PREFERRED_WEB_PORT"
export PREYAS_WEB_PORT="$WEB_PORT"
printf '4105\n' >"$STATE/port/8081"
printf 'node expo start --web\n' >"$STATE/cmd/4105"
set_pid 4105 web
healthy web
out="$(start_service web)"
assert_eq "own listener: Expo is not started again" "$(events | grep -c '^launch web ')" "0"
assert_contains "own listener: reported as already running" "$out" "already running"

# Brain already up on the default port must be restarted so trust matches.
reset_world
set_pid 4804 brain
healthy brain
printf '2605\n' >"$STATE/port/8081"
printf 'Cursor\n' >"$STATE/cmd/2605"
out="$(start_all)"
assert_eq "trust: brain is stopped when the page moves" "$(events | grep -c '^signal TERM 4804$')" "1"
assert_eq "trust: brain is started with the new port" "$(events | grep -c '^launch brain webport=8082$')" "1"
assert_contains "trust: the message says why the brain restarted" "$out" "trusts http://localhost:8082"
assert_eq "trust: only the brain is signalled" "$(events | grep '^signal ' | tr '\n' ' ')" "signal TERM 4804 signal KILL 4804 "

# restart of one service does not stop the others, even through main.
reset_world
set_pid 4901 llama
set_pid 4902 litellm
set_pid 4905 web
main restart litellm >/dev/null
assert_eq "restart litellm: stops litellm" "$(events | grep -c '^signal TERM 4902$')" "1"
assert_eq "restart litellm: starts litellm" "$(events | grep -c '^launch litellm ')" "1"
assert_eq "restart litellm: leaves llama" "$(events | grep -c '4901')" "0"
assert_eq "restart litellm: leaves web" "$(events | grep -c '4905')" "0"

# restart web moves off a foreign port and restarts only the brain.
reset_world
rm -f "$PREYAS_LOG_DIR/web.port"
WEB_PORT="$PREFERRED_WEB_PORT"
export PREYAS_WEB_PORT="$WEB_PORT"
set_pid 5001 llama
set_pid 5004 brain
printf '2605\n' >"$STATE/port/8081"
printf 'Cursor\n' >"$STATE/cmd/2605"
out="$(main restart web)"
assert_eq "restart web: Expo moves to the free port" "$(events | grep -c '^launch web webport=8082$')" "1"
assert_eq "restart web: brain is restarted for the new origin" "$(events | grep -c '^signal TERM 5004$')" "1"
assert_eq "restart web: brain comes back on that port" "$(events | grep -c '^launch brain webport=8082$')" "1"
assert_eq "restart web: llama is untouched" "$(events | grep -c '5001')" "0"
assert_contains "restart web: says the brain is catching the new port" "$out" "trusts http://localhost:8082"

# ---------------------------------------------------- resident model memory
fp="$(parse_footprint_kb 'phys_footprint: 1.1 GB')"
assert_eq "footprint: 1.1 GB is the mapped size in KB" "$fp" "1153434"
fp="$(parse_footprint_kb "$(printf '%s\n' 'phys_footprint_peak: 9 GB' 'Physical footprint:         1126 MB')")"
assert_eq "footprint: the live line, not the peak" "$fp" "1153024"
fp="$(parse_footprint_kb 'phys_footprint_peak: 9 GB')"
assert_eq "footprint: a peak-only line is not a size" "$fp" ""

mac_kb=$(
  ram_kb_of_pid() {
    case "$1" in
      10|11|12) echo 19456 ;;
      *) echo 0 ;;
    esac
  }
  child_pids() {
    case "$1" in
      10) printf '11\n' ;;
      11) printf '12\n' ;;
    esac
  }
  footprint_text() {
    case "$1" in
      12) printf 'phys_footprint: 1.1 GB\nphys_footprint_peak: 3 GB\n' ;;
    esac
  }
  is_mac() { return 0; }
  resident_tree_kb 10
)
mac_mb=$((mac_kb / 1024))
if (( mac_mb >= 1100 && mac_mb < 1300 )); then
  ok "ram: macOS footprint of a grandchild counts (${mac_mb} MB)"
else
  not_ok "ram: macOS footprint of a grandchild counts (${mac_mb} MB)"
fi

linux_kb=$(
  ram_kb_of_pid() {
    case "$1" in
      10) echo 19456 ;;
      11) echo 1126400 ;;
      *) echo 0 ;;
    esac
  }
  child_pids() {
    case "$1" in
      10) printf '11\n' ;;
    esac
  }
  footprint_text() { :; }
  is_mac() { return 1; }
  resident_tree_kb 10
)
linux_mb=$((linux_kb / 1024))
if (( linux_mb >= 1100 )); then
  ok "ram: a child RSS counts when footprint is absent (${linux_mb} MB)"
else
  not_ok "ram: a child RSS counts when footprint is absent (${linux_mb} MB)"
fi

printf '\n%d passed, %d failed\n' "$pass" "$fail"
[[ "$fail" -eq 0 ]]
