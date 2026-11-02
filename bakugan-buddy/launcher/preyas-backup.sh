#!/usr/bin/env bash
# Nightly backup of Preyas's own data: history and memory only.
#
# Never touches cache, logs, models or documents. Keeps the newest 14 archives
# and removes only older preyas-*.zip files inside the backups folder.
set -euo pipefail

DRIVE="${PREYAS_DRIVE:-/Volumes/Agent}"
BUDDY="$DRIVE/BakuganBuddy"
BACKUPS="$BUDDY/backups"
KEEP=14
STAMP_LOG="$BUDDY/backups/.last-backup"

say() { printf '%s %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*"; }

if [[ ! -d "$BUDDY" ]]; then
  say "Agent drive is not mounted; no backup."
  exit 0
fi

mkdir -p "$BACKUPS"

# One backup per day: if today's archive already exists, do nothing.
TODAY="$(date '+%Y-%m-%d')"
TARGET="$BACKUPS/preyas-$TODAY.zip"
if [[ -f "$TARGET" ]]; then
  say "Backup for $TODAY already exists."
  exit 0
fi

SOURCES=()
for part in history memory; do
  [[ -d "$BUDDY/$part" ]] && SOURCES+=("$part")
done
if (( ${#SOURCES[@]} == 0 )); then
  say "Nothing to back up yet."
  exit 0
fi

# Build in a temp file first, so a crash cannot leave a half-written zip.
TEMP="$BACKUPS/.partial-$TODAY.zip"
rm -f "$TEMP"
if ( cd "$BUDDY" && zip -q -r -X "$TEMP" "${SOURCES[@]}" ); then
  mv "$TEMP" "$TARGET"
  say "Wrote $TARGET ($(du -h "$TARGET" | cut -f1))."
else
  rm -f "$TEMP"
  say "Backup failed; the previous archives are untouched."
  exit 1
fi
printf '%s\n' "$TODAY" > "$STAMP_LOG"

# Retention: newest 14 by name (the date sorts lexically), delete the rest.
LIST="$(find "$BACKUPS" -maxdepth 1 -type f -name 'preyas-*.zip' -print | sort)"
COUNT="$(printf '%s\n' "$LIST" | grep -c . || true)"
if (( COUNT > KEEP )); then
  REMOVE=$((COUNT - KEEP))
  printf '%s\n' "$LIST" | head -n "$REMOVE" | while IFS= read -r old; do
    [[ -n "$old" ]] || continue
    rm -f "$old" && say "Removed old backup $(basename "$old")."
  done
fi

KEPT=$(( COUNT > KEEP ? KEEP : COUNT ))
say "Kept $KEPT backup(s)."
