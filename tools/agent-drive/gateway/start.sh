#!/usr/bin/env bash
# LiteLLM proxy on 127.0.0.1:4000.
# model "local" -> llama-server's OpenAI API (brain-server publishes it on :8788).
# model "paid" (deepseek-flash) is added only when secrets/.env contains DEEPSEEK_API_KEY.
set -euo pipefail
HERE="$(cd "$(dirname "$0")/.." && pwd)"
export PYTHONPATH="${HERE}${PYTHONPATH:+:$PYTHONPATH}"
export AGENT_DRIVE_ROOT="${AGENT_DRIVE_ROOT:-/Volumes/Agent/agent}"
export JSON_LOGS=true
export PYTHONUNBUFFERED=1

if [[ -f "$AGENT_DRIVE_ROOT/secrets/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "$AGENT_DRIVE_ROOT/secrets/.env"
  set +a
fi

PY="$AGENT_DRIVE_ROOT/venv/bin/python"
LITELLM="$AGENT_DRIVE_ROOT/venv/bin/litellm"
if [[ ! -x "$LITELLM" ]]; then
  echo "No gateway venv at $AGENT_DRIVE_ROOT/venv." >&2
  echo "Plug in the drive and run ./setup.sh from $HERE." >&2
  exit 1
fi

CONFIG="$("$PY" -m agent_drive.gateway_config)"
PORT="${AGENT_DRIVE_PORT:-4000}"
mkdir -p "$AGENT_DRIVE_ROOT/logs" "$AGENT_DRIVE_ROOT/cache/litellm"
echo "agent-drive gateway http://127.0.0.1:${PORT}/v1  model local -> ${AGENT_DRIVE_LOCAL_API_BASE:-http://127.0.0.1:8788/v1}"
echo "paid fallback: deepseek-flash at https://api.deepseek.com when DEEPSEEK_API_KEY is set; deepseek-v4-pro is explicit only"
echo "disk cache: $AGENT_DRIVE_ROOT/cache/litellm"
echo "json logs:  $AGENT_DRIVE_ROOT/logs/gateway.jsonl and $AGENT_DRIVE_ROOT/logs/litellm.jsonl"
# One worker. The disk cache is per process.
"$LITELLM" \
  --config "$CONFIG" \
  --host 127.0.0.1 \
  --port "$PORT" \
  2>&1 | tee -a "$AGENT_DRIVE_ROOT/logs/litellm.jsonl"
