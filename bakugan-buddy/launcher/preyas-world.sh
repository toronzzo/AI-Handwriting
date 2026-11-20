#!/usr/bin/env bash
# Start the Preyas World desktop pet (Godot) in the background.
#
# The pet is a borderless transparent strip along the bottom of the screen.
# Click him to open the chat; right-click for Hide for 1 hour / Quit.
# Safe to run twice — if the pet is already running, this exits.
#
# Not wired into preyas-up.sh yet; run it on its own for now.
set -euo pipefail

REPO_ROOT="${PREYAS_REPO_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
GODOT_BIN="${GODOT_BIN:-/Applications/Godot.app/Contents/MacOS/Godot}"
PROJECT="$REPO_ROOT/bakugan-buddy/apps/preyas-world"
LOG_DIR="${PREYAS_LOG_DIR:-$HOME/Library/Logs/PreyasWorld}"
LOG="$LOG_DIR/pet.log"

mkdir -p "$LOG_DIR"

say() { printf '%s %s\n' "$(date '+%H:%M:%S')" "$*" | tee -a "$LOG"; }

if pgrep -f "Godot.app/Contents/MacOS/Godot --path .*preyas-world" >/dev/null 2>&1; then
  say "Preyas World is already running."
  exit 0
fi

if [[ ! -x "$GODOT_BIN" ]]; then
  say "Godot not found at $GODOT_BIN (set GODOT_BIN to override)."
  exit 1
fi

nohup "$GODOT_BIN" --path "$PROJECT" >>"$LOG" 2>&1 &
disown
say "Preyas World started (pid $!). Quit it from its right-click menu."
