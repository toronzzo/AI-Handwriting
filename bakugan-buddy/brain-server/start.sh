#!/usr/bin/env bash
# Start Preyas's brain on the LAN. One command after setup.sh.
# llama-server stays on localhost. A small proxy on 0.0.0.0:8788 adds CORS
# so Expo web can stream, and refuses to run if the external drive is absent.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=lib/ensure-drive.sh
source "$ROOT/lib/ensure-drive.sh"

if [[ ! -f "$ROOT/brain.env" ]]; then
  echo "No brain.env. Plug in the external drive and run ./setup.sh." >&2
  exit 1
fi
set -a
# shellcheck disable=SC1091
source "$ROOT/brain.env"
set +a
split_agent_roots "$ROOT/brain.env"
ensure_bakugan_drive
echo "Preyas data: $BAKUGAN_DATA_DIR"
echo "Gateway root: $AGENT_DRIVE_ROOT"

# shellcheck source=lib/prebuilt-tools.sh
source "$ROOT/lib/prebuilt-tools.sh"
require_llama_server
if [[ ! -f "$BAKUGAN_DATA_DIR/brain.json" ]]; then
  echo "No brain.json on the drive. Run ./setup.sh." >&2
  exit 1
fi

eval "$(node "$ROOT/lib/select-model.mjs" "$ROOT/models.json" "$BAKUGAN_DATA_DIR/brain.json")"

GGUF="$BAKUGAN_DATA_DIR/models/$MODEL_FILE"
if [[ ! -f "$GGUF" ]]; then
  echo "Model file is not on the drive: $GGUF" >&2
  echo "Run ./setup.sh --model $MODEL_ID" >&2
  exit 1
fi

if [[ "$MODEL_WARN" == "1" && "${BRAIN_ALLOW_LARGE:-}" != "1" ]]; then
  echo "WARNING: $MODEL_LABEL needs $MODEL_RAM on a 16 GB M1 Pro." >&2
  echo "macOS will swap. Answers get slow. The default 8B tier is the one that stays responsive." >&2
  if [[ -t 0 ]]; then
    read -r -p "Type LARGE to start it anyway: " typed
    if [[ "$typed" != "LARGE" ]]; then
      echo "Staying stopped. Switch back with ./use-model.sh default" >&2
      exit 1
    fi
  else
    echo "Set BRAIN_ALLOW_LARGE=1 to start this tier without a prompt." >&2
    exit 1
  fi
fi

LLAMA_PORT=8790
BRAIN_PORT="${BRAIN_PORT:-8788}"
# Context window. 16384 fits this 16 GB Mac; 24576 also works but uses more swap.
LLAMA_CTX="${LLAMA_CTX:-16384}"
if [[ ! "$LLAMA_CTX" =~ ^[0-9]+$ ]]; then
  echo "LLAMA_CTX must be a number, got: $LLAMA_CTX" >&2
  exit 1
fi
TEMPLATE="$ROOT/templates/qwen3.jinja"
mkdir -p "$BAKUGAN_DATA_DIR/logs" "$BAKUGAN_DATA_DIR/memory" "$BAKUGAN_DATA_DIR/cache"

CACHE_ARGS=()
HELP="$("$LLAMA_BIN" --help 2>&1 || true)"
if grep -q -- '--cache-reuse' <<<"$HELP"; then
  CACHE_ARGS+=(--cache-reuse 256)
fi
if grep -q -- '--slot-save-path' <<<"$HELP"; then
  CACHE_ARGS+=(--slot-save-path "$BAKUGAN_DATA_DIR/cache/llama-slots")
fi
if grep -q -- '--parallel' <<<"$HELP"; then
  CACHE_ARGS+=(--parallel 1)
fi
if grep -q -- '--slots' <<<"$HELP"; then
  CACHE_ARGS+=(--slots)
fi
if grep -q -- '--flash-attn' <<<"$HELP"; then
  CACHE_ARGS+=(--flash-attn on)
fi
# This GGUF carries no chat template, so tool calls need the Qwen3 template.
if [[ -f "$TEMPLATE" ]]; then
  CACHE_ARGS+=(--chat-template-file "$TEMPLATE")
fi

LLAMA_URL_BASE="http://127.0.0.1:${LLAMA_PORT}"
LLAMA_PID=""

# Reuse a server that is already answering instead of starting a second one.
if curl -sf "${LLAMA_URL_BASE}/health" >/dev/null 2>&1; then
  echo "Reusing the llama-server already healthy on ${LLAMA_URL_BASE}; LLAMA_CTX=$LLAMA_CTX does not apply to it."
else
  "$LLAMA_BIN" \
    -m "$GGUF" \
    --host 127.0.0.1 \
    --port "$LLAMA_PORT" \
    -c "$LLAMA_CTX" \
    -ngl 99 \
    -t 8 \
    --jinja \
    --cache-type-k q8_0 \
    --cache-type-v q8_0 \
    "${CACHE_ARGS[@]}" \
    --log-file "$BAKUGAN_DATA_DIR/logs/llama.log" \
    >/dev/null 2>&1 &
  LLAMA_PID=$!
fi

cleanup() {
  if [[ -n "${DNS_PID:-}" ]]; then kill "$DNS_PID" 2>/dev/null || true; fi
  if [[ -n "${WHISPER_PID:-}" ]]; then kill "$WHISPER_PID" 2>/dev/null || true; fi
  if [[ -n "${GATEWAY_PID:-}" ]]; then
    kill "$GATEWAY_PID" 2>/dev/null || true
    # gateway/start.sh is a shell; stop the litellm child too. Not a name match.
    pkill -P "$GATEWAY_PID" 2>/dev/null || true
  fi
  # A reused server belongs to someone else; never stop it.
  if [[ -n "$LLAMA_PID" ]]; then kill "$LLAMA_PID" 2>/dev/null || true; fi
}
trap cleanup EXIT INT TERM

if [[ -n "$LLAMA_PID" ]]; then
  ready=0
  for _ in $(seq 1 60); do
    if curl -sf "http://127.0.0.1:${LLAMA_PORT}/health" >/dev/null 2>&1; then
      ready=1
      break
    fi
    if ! kill -0 "$LLAMA_PID" 2>/dev/null; then
      echo "llama-server exited. See $BAKUGAN_DATA_DIR/logs/llama.log" >&2
      exit 1
    fi
    sleep 0.5
  done
  if [[ "$ready" != "1" ]]; then
    echo "llama-server did not become healthy. See $BAKUGAN_DATA_DIR/logs/llama.log" >&2
    exit 1
  fi
fi

if [[ -z "${WHISPER_SERVER:-}" ]]; then
  WHISPER_SERVER="$(find_existing_bin whisper-server || true)"
fi
if [[ -n "${WHISPER_MODEL:-}" && -f "${WHISPER_MODEL}" && -n "${WHISPER_SERVER:-}" && -x "${WHISPER_SERVER}" ]]; then
  "$WHISPER_SERVER" -m "$WHISPER_MODEL" --host 127.0.0.1 --port 8178 >/dev/null 2>&1 &
  WHISPER_PID=$!
  export WHISPER_URL="http://127.0.0.1:8178"
  echo "Whisper server: $WHISPER_URL"
else
  echo "Whisper server not started. ./setup-all.sh builds whisper.cpp and downloads the base model."
fi

export LLAMA_URL="http://127.0.0.1:${LLAMA_PORT}"
export BAKUGAN_DATA_DIR
node --experimental-strip-types --disable-warning=ExperimentalWarning "$ROOT/lib/warm-cache.mjs" || true

if command -v dns-sd >/dev/null 2>&1; then
  dns-sd -R "Bakugan Brain" _bakugan-brain._tcp local "$BRAIN_PORT" >/dev/null 2>&1 &
  DNS_PID=$!
fi

GATEWAY_PID=""
mkdir -p "$AGENT_DRIVE_ROOT/logs" "$BAKUGAN_DATA_DIR/history" 2>/dev/null || true
node --experimental-strip-types --disable-warning=ExperimentalWarning --input-type=module <<EOF || true
import { mergeHistoryFiles } from "${ROOT}/lib/history.mjs";
const data = process.env.BAKUGAN_DATA_DIR;
const agent = process.env.AGENT_DRIVE_ROOT || "/Volumes/Agent/agent";
const buddy = "/Volumes/Agent/BakuganBuddy";
const merged = mergeHistoryFiles(data, agent).added + mergeHistoryFiles(data, buddy).added;
if (merged) console.log("Merged " + merged + " chat lines into " + data + "/history (sources kept).");
EOF
SECRETS="$AGENT_DRIVE_ROOT/secrets/.env"
GW_DIR="$(cd "$ROOT/../../tools/agent-drive" && pwd)"
if [[ -x "$AGENT_DRIVE_ROOT/venv/bin/litellm" && -f "$SECRETS" ]] && grep -Eq '^DEEPSEEK_API_KEY=.+' "$SECRETS" && ! grep -Eq '^DEEPSEEK_API_KEY=(changeme)?$' "$SECRETS"; then
  AGENT_DRIVE_ROOT="$AGENT_DRIVE_ROOT" "$GW_DIR/gateway/start.sh" >>"$AGENT_DRIVE_ROOT/logs/gateway.out" 2>&1 &
  GATEWAY_PID=$!
  echo "Paid model: gateway on http://127.0.0.1:4000 (DeepSeek flash)."
else
  echo "Paid model: off. Local brain only. Add DEEPSEEK_API_KEY to $AGENT_DRIVE_ROOT/secrets/.env to turn it on."
fi

LAN_IP="$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || true)"
echo "Preyas brain: $MODEL_LABEL"
echo "Context $LLAMA_CTX, llama RAM $MODEL_RAM"
echo "Phone URL: http://${LAN_IP:-<this-mac-ip>}:${BRAIN_PORT}"
echo "This Mac:  http://127.0.0.1:${BRAIN_PORT}"
echo "Chat page: open Bakugan Buddy and tap Chat."
echo "On this Mac, in another window: cd bakugan-buddy/apps/mobile && npm run web"
echo "Expo prints a local URL, usually http://localhost:8081. Use that page."
echo "Point the page at this brain: http://127.0.0.1:${BRAIN_PORT}"
echo "Phone on the same Wi-Fi: http://${LAN_IP:-<this-mac-ip>}:${BRAIN_PORT}"
echo "Logs: $BAKUGAN_DATA_DIR/logs/llama.log"
echo "Ctrl-C stops the brain, the voice server, and the paid gateway."

export LLAMA_URL="http://127.0.0.1:${LLAMA_PORT}"
export BRAIN_PORT
export BRAIN_HOST="${BRAIN_HOST:-0.0.0.0}"
export BRAIN_LABEL="$MODEL_LABEL"
export BRAIN_WARN="$MODEL_WARN"
export BAKUGAN_DATA_DIR
exec node --experimental-strip-types --disable-warning=ExperimentalWarning "$ROOT/proxy.mjs"
