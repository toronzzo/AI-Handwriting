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
ensure_bakugan_drive

if ! command -v llama-server >/dev/null 2>&1; then
  echo "llama-server is not installed. On the Mac: brew install llama.cpp" >&2
  exit 1
fi
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
mkdir -p "$BAKUGAN_DATA_DIR/logs" "$BAKUGAN_DATA_DIR/memory" "$BAKUGAN_DATA_DIR/cache"

CACHE_ARGS=()
HELP="$(llama-server --help 2>&1 || true)"
if grep -q -- '--cache-reuse' <<<"$HELP"; then
  CACHE_ARGS+=(--cache-reuse 256)
fi
if grep -q -- '--slot-save-path' <<<"$HELP"; then
  CACHE_ARGS+=(--slot-save-path "$BAKUGAN_DATA_DIR/cache")
fi
if grep -q -- '--parallel' <<<"$HELP"; then
  CACHE_ARGS+=(--parallel 2)
fi

llama-server \
  -m "$GGUF" \
  --host 127.0.0.1 \
  --port "$LLAMA_PORT" \
  -c "$MODEL_CTX" \
  -ngl 99 \
  -t 6 \
  --jinja \
  --cache-type-k q8_0 \
  --cache-type-v q8_0 \
  "${CACHE_ARGS[@]}" \
  --log-file "$BAKUGAN_DATA_DIR/logs/llama.log" \
  >/dev/null 2>&1 &
LLAMA_PID=$!

cleanup() {
  if [[ -n "${DNS_PID:-}" ]]; then kill "$DNS_PID" 2>/dev/null || true; fi
  kill "$LLAMA_PID" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

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

export LLAMA_URL="http://127.0.0.1:${LLAMA_PORT}"
export BAKUGAN_DATA_DIR
node --experimental-strip-types --disable-warning=ExperimentalWarning "$ROOT/lib/warm-cache.mjs" || true

if command -v dns-sd >/dev/null 2>&1; then
  dns-sd -R "Bakugan Brain" _bakugan-brain._tcp local "$BRAIN_PORT" >/dev/null 2>&1 &
  DNS_PID=$!
fi

LAN_IP="$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || true)"
echo "Preyas brain: $MODEL_LABEL"
echo "Context $MODEL_CTX, llama RAM $MODEL_RAM"
echo "Phone URL: http://${LAN_IP:-<this-mac-ip>}:${BRAIN_PORT}"
echo "This Mac:  http://127.0.0.1:${BRAIN_PORT}"
echo "LiteLLM, if you run one: http://${LAN_IP:-<this-mac-ip>}:4000"
echo "Logs: $BAKUGAN_DATA_DIR/logs/llama.log"
echo "Ctrl-C stops the server."

export LLAMA_URL="http://127.0.0.1:${LLAMA_PORT}"
export BRAIN_PORT
export BRAIN_HOST="${BRAIN_HOST:-0.0.0.0}"
export BRAIN_LABEL="$MODEL_LABEL"
export BRAIN_WARN="$MODEL_WARN"
export BAKUGAN_DATA_DIR
exec node --experimental-strip-types --disable-warning=ExperimentalWarning "$ROOT/proxy.mjs"
