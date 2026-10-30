#!/usr/bin/env bash
# Print the DeepSeek peak window, or wait until off-peak and run a command.
#   ./bin/offpeak.sh
#   ./bin/offpeak.sh --wait -- curl http://127.0.0.1:4000/v1/chat/completions ...
set -euo pipefail
HERE="$(cd "$(dirname "$0")/.." && pwd)"
export PYTHONPATH="${HERE}${PYTHONPATH:+:$PYTHONPATH}"
export AGENT_DRIVE_ROOT="${AGENT_DRIVE_ROOT:-/Volumes/Agent/agent}"
exec python3 -m agent_drive.offpeak "$@"
