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
  mkdir -p "$STATE/alive" "$STATE/health" "$STATE/pidof" "$STATE/port"
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
pid_matches() { return 0; }
health_ok() { [[ -f "$STATE/health/$1" ]]; }
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
  event "launch $name"
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
assert_eq "start: every service is launched in order" "$(events | grep '^launch ' | tr '\n' ' ')" "launch llama launch litellm launch kiwix launch brain launch web "
assert_eq "start: all services healthy" "$(events | grep -c '^launch ')" "5"

# ------------------------------------------------------- skip already running
reset_world
healthy litellm
start_all >/dev/null 2>&1
assert_eq "start: a healthy service is not started twice" "$(events | grep -c '^launch litellm$')" "0"
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
assert_eq "start: kiwix is not launched without packs" "$(events | grep -c '^launch kiwix$')" "0"
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
launch_order="$(events | grep '^launch ' | sed 's/^launch //' | tr '\n' ' ')"
assert_eq "restart: starts in the normal order" "$launch_order" "llama litellm kiwix brain web "

# --------------------------------------------------------- restart one service
reset_world
set_pid 4501 llama
set_pid 4504 brain
restart_one brain >/dev/null 2>&1
assert_eq "restart brain: stops brain" "$(events | grep -c '^signal TERM 4504$')" "1"
assert_eq "restart brain: starts brain" "$(events | grep -c '^launch brain$')" "1"
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
pid_matches() { return 0; }

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
