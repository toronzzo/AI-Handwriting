#!/usr/bin/env bash
# Put the three one-click Preyas launchers on the Desktop.
#
#   scripts/install-desktop-launchers.sh
#
# The launchers call this checkout's scripts/preyas.sh. If the checkout moves,
# run this installer again (or set PREYAS_CONTROL when double-clicking).
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEST="${PREYAS_DESKTOP_DIR:-$HOME/Desktop}"
SRC="$REPO_ROOT/bakugan-buddy/launcher"
CONTROLLER="$REPO_ROOT/scripts/preyas.sh"

if [[ ! -x "$CONTROLLER" && ! -f "$CONTROLLER" ]]; then
  echo "Missing controller: $CONTROLLER" >&2
  exit 1
fi

mkdir -p "$DEST" || { echo "Could not create $DEST" >&2; exit 1; }

install_one() {
  local source="$1" target="$2" temp
  if [[ ! -f "$source" ]]; then
    echo "Missing launcher template: $source" >&2
    return 1
  fi
  temp="$(mktemp "${TMPDIR:-/tmp}/preyas-launcher.XXXXXX")" || return 1
  sed "s|__PREYAS_SCRIPT__|$CONTROLLER|g" "$source" >"$temp" || { rm -f "$temp"; return 1; }
  chmod +x "$temp"
  mv "$temp" "$target" || { rm -f "$temp"; return 1; }
  echo "Created $target"
}

ok=0
install_one "$SRC/preyas-on.command" "$DEST/Preyas ON.command" || ok=1
install_one "$SRC/preyas-off.command" "$DEST/Preyas OFF.command" || ok=1
install_one "$SRC/preyas-restart.command" "$DEST/Preyas RESTART.command" || ok=1

if ((ok == 0)); then
  echo "Double-click them on the Desktop. ON also opens the app."
fi
exit "$ok"
