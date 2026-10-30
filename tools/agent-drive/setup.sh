#!/usr/bin/env bash
# Create the external-drive workspace. Safe to run again.
# Refuses, with a clear message, when the drive is missing or not writable.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
export PYTHONPATH="${HERE}${PYTHONPATH:+:$PYTHONPATH}"
export AGENT_DRIVE_ROOT="${AGENT_DRIVE_ROOT:-/Volumes/Agent/agent}"
exec python3 -m agent_drive.setup
