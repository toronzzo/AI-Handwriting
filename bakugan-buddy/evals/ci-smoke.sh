#!/usr/bin/env bash
# Start mock llama + studio, run 5-case smoke, tear down.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
EVALS="$ROOT/evals"
STUDIO="$ROOT/studio"
export LLAMA_SERVER_URL="http://127.0.0.1:8080"
export STUDIO_URL="http://127.0.0.1:8787"

node "$EVALS/mock-llama.mjs" &
MOCK_PID=$!
cleanup() {
  kill "$STUDIO_PID" "$MOCK_PID" 2>/dev/null || true
  wait "$STUDIO_PID" "$MOCK_PID" 2>/dev/null || true
}
trap cleanup EXIT

# wait mock
for i in $(seq 1 30); do
  if curl -sf http://127.0.0.1:8080/health >/dev/null; then break; fi
  sleep 0.2
done

node "$STUDIO/server.mjs" &
STUDIO_PID=$!
for i in $(seq 1 40); do
  if curl -sf http://127.0.0.1:8787/v1/health | grep -q '"ready":true'; then
    # llm.ready true
    if curl -sf http://127.0.0.1:8787/v1/health | grep -q '"llm"'; then
      READY=$(curl -sf http://127.0.0.1:8787/v1/health | python3 -c "import sys,json; print(json.load(sys.stdin)['llm']['ready'])")
      if [[ "$READY" == "True" || "$READY" == "true" ]]; then break; fi
    fi
  fi
  sleep 0.25
done

cd "$EVALS"
node --experimental-strip-types --disable-warning=ExperimentalWarning run.ts --cases smoke.jsonl --fail-below 1
