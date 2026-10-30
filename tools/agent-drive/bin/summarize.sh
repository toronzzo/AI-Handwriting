#!/usr/bin/env bash
# Summarize a history session with the local model (gateway by default).
set -euo pipefail
HERE="$(cd "$(dirname "$0")/.." && pwd)"
export PYTHONPATH="${HERE}${PYTHONPATH:+:$PYTHONPATH}"
export AGENT_DRIVE_ROOT="${AGENT_DRIVE_ROOT:-/Volumes/Agent/agent}"
exec python3 -m agent_drive.summarize "$@"
