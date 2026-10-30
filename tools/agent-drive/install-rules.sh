#!/usr/bin/env bash
# Copy AGENTS.md and the Cursor rule into each git repo under $AGENT_DRIVE_ROOT/repos.
# The copies are listed in .git/info/exclude so they stay untracked.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
export PYTHONPATH="${HERE}${PYTHONPATH:+:$PYTHONPATH}"
export AGENT_DRIVE_ROOT="${AGENT_DRIVE_ROOT:-/Volumes/Agent/agent}"
exec python3 -m agent_drive.rules
