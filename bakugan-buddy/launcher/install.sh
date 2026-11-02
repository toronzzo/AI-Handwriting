#!/usr/bin/env bash
# Install Preyas as a real Mac app and, optionally, at login.
#
#   ./install.sh                build ~/Applications/Preyas.app
#   ./install.sh --autostart    also start Preyas at login
#   ./install.sh --no-autostart remove only the login item
#
# Never asks a question. Prints what it did.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
LAUNCHER="$REPO_ROOT/bakugan-buddy/launcher"
APP_DIR="$HOME/Applications"
APP="$APP_DIR/Preyas.app"
ICON_SRC="$REPO_ROOT/bakugan-buddy/apps/mobile/assets/icon.png"
PLIST="$HOME/Library/LaunchAgents/com.toronzzo.preyas.plist"
LABEL="com.toronzzo.preyas"
AUTOSTART="ask-nothing"
for arg in "$@"; do
  case "$arg" in
    --autostart) AUTOSTART="yes" ;;
    --no-autostart) AUTOSTART="no" ;;
    *) echo "Unknown option: $arg" >&2; exit 2 ;;
  esac
done

say() { printf '%s\n' "$*"; }

remove_autostart() {
  if [[ -f "$PLIST" ]]; then
    launchctl bootout "gui/$(id -u)" "$PLIST" >/dev/null 2>&1 || launchctl unload "$PLIST" >/dev/null 2>&1 || true
    rm -f "$PLIST"
    say "Removed the login item ($PLIST). Preyas will not start by itself."
  else
    say "No login item to remove."
  fi
}

if [[ "$AUTOSTART" == "no" ]]; then
  remove_autostart
  exit 0
fi

# 1. The app bundle: an AppleScript that runs our up script.
mkdir -p "$APP_DIR"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

cat > "$WORK/main.applescript" <<APPLESCRIPT
on run
  set upScript to "$LAUNCHER/preyas-up.sh"
  try
    do shell script quoted form of upScript
  on error errMsg
    display dialog "Preyas could not start: " & errMsg buttons {"OK"} default button 1
  end try
end run
APPLESCRIPT

osacompile -o "$APP" "$WORK/main.applescript" >/dev/null
say "Built $APP"

# 2. A proper .icns from the existing art.
if [[ -f "$ICON_SRC" && -x /usr/bin/sips ]]; then
  ICONSET="$WORK/Preyas.iconset"
  mkdir -p "$ICONSET"
  for size in 16 32 64 128 256 512; do
    sips -z "$size" "$size" "$ICON_SRC" --out "$ICONSET/icon_${size}x${size}.png" >/dev/null 2>&1 || true
    double=$((size * 2))
    sips -z "$double" "$double" "$ICON_SRC" --out "$ICONSET/icon_${size}x${size}@2x.png" >/dev/null 2>&1 || true
  done
  if iconutil -c icns "$ICONSET" -o "$WORK/Preyas.icns" >/dev/null 2>&1; then
    cp "$WORK/Preyas.icns" "$APP/Contents/Resources/applet.icns"
    say "Installed the Preyas icon."
  else
    say "Could not build the icon; the app keeps the default one."
  fi
fi

# 3. Launch at login, when asked.
if [[ "$AUTOSTART" == "yes" ]]; then
  mkdir -p "$HOME/Library/LaunchAgents"
  cat > "$PLIST" <<PLISTXML
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>$LAUNCHER/preyas-up.sh</string>
    <string>--no-open</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>StartCalendarInterval</key>
  <array>
    <dict><key>Hour</key><integer>3</integer><key>Minute</key><integer>0</integer></dict>
  </array>
  <key>StandardOutPath</key><string>$HOME/Library/Logs/preyas-launchagent.log</string>
  <key>StandardErrorPath</key><string>$HOME/Library/Logs/preyas-launchagent.log</string>
</dict>
</plist>
PLISTXML
  launchctl bootout "gui/$(id -u)" "$PLIST" >/dev/null 2>&1 || true
  if launchctl bootstrap "gui/$(id -u)" "$PLIST" >/dev/null 2>&1 || launchctl load "$PLIST" >/dev/null 2>&1; then
    say "Installed the login item ($PLIST)."
  else
    say "Wrote the login item, but launchctl did not load it; it will load at next login."
  fi
fi

say ""
say "Done. To finish:"
say "  1. Open $APP_DIR in Finder and drag Preyas onto the Dock."
say "  2. Double-click it whenever you want Preyas running."
if [[ "$AUTOSTART" != "yes" ]]; then
  say "  3. Later, to start Preyas at login:  $LAUNCHER/install.sh --autostart"
fi
