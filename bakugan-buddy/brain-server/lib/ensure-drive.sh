#!/usr/bin/env bash
# Refuse to use the internal disk. BAKUGAN_DATA_DIR must be a mounted /Volumes path.
# Source this file. It exits the caller on failure.

ensure_bakugan_drive() {
  local dir="${BAKUGAN_DATA_DIR:-}"
  if [[ -z "$dir" ]]; then
    echo "BAKUGAN_DATA_DIR is not set." >&2
    echo "Run ./setup.sh with the external drive plugged in." >&2
    exit 1
  fi
  if [[ "$dir" != /Volumes/* ]]; then
    if [[ "${BAKUGAN_ALLOW_INTERNAL:-}" == "1" ]]; then
      echo "WARNING: BAKUGAN_ALLOW_INTERNAL=1, using $dir on the internal disk." >&2
      mkdir -p "$dir"
      return 0
    fi
    echo "Refusing to put models on the internal disk: $dir" >&2
    echo "Plug in the external drive and set BAKUGAN_DATA_DIR to /Volumes/<Drive>/BakuganBuddy." >&2
    exit 1
  fi
  local rest="${dir#/Volumes/}"
  local volume="${rest%%/*}"
  if [[ -z "$volume" || "$volume" == "$dir" ]]; then
    echo "BAKUGAN_DATA_DIR must look like /Volumes/<Drive>/BakuganBuddy." >&2
    echo "Got: $dir" >&2
    exit 1
  fi
  case "$volume" in
    "Macintosh HD"*|Recovery|Preboot|Update|VM|com.apple*)
      echo "Refusing system volume '$volume'." >&2
      echo "Pick the external drive under /Volumes." >&2
      exit 1
      ;;
  esac
  if ! mount | grep -F " on /Volumes/$volume " >/dev/null 2>&1; then
    echo "The external drive is not mounted: /Volumes/$volume" >&2
    echo "Plug in the drive that holds Bakugan Buddy data, then run this again." >&2
    echo "Nothing was written to the internal disk." >&2
    exit 1
  fi
  mkdir -p "$dir"
}
