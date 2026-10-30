#!/usr/bin/env bash
# Print llama-server cache flags, or save/restore a KV slot.
# See docs/llama-cache.md. Does not modify bakugan-buddy/brain-server.
set -euo pipefail
HERE="$(cd "$(dirname "$0")/.." && pwd)"
export PYTHONPATH="${HERE}${PYTHONPATH:+:$PYTHONPATH}"
export AGENT_DRIVE_ROOT="${AGENT_DRIVE_ROOT:-/Volumes/Agent/agent}"
exec python3 -m agent_drive.llama_cache "$@"
