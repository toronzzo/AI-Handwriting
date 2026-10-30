#!/usr/bin/env bash
# Print the last 3 summaries and the skills index, plus a new session id.
set -euo pipefail
HERE="$(cd "$(dirname "$0")/.." && pwd)"
export PYTHONPATH="${HERE}${PYTHONPATH:+:$PYTHONPATH}"
export AGENT_DRIVE_ROOT="${AGENT_DRIVE_ROOT:-/Volumes/Agent/agent}"
exec python3 -m agent_drive.session
