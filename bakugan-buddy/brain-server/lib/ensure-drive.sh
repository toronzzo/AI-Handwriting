#!/usr/bin/env bash
# Refuse to use the internal disk. BAKUGAN_DATA_DIR must be a mounted /Volumes path.
# Default data root: the APFS volume Agent. Override with BAKUGAN_DATA_DIR.
# Exits if Agent is not mounted and no override was set.
resolve_bakugan_data_dir() {
  if [[ -n "${BAKUGAN_DATA_DIR:-}" ]]; then
    return 0
  fi
  if mount | grep -F " on /Volumes/Agent " >/dev/null 2>&1; then
    BAKUGAN_DATA_DIR="/Volumes/Agent/agent"
    export BAKUGAN_DATA_DIR
    echo "Data root: $BAKUGAN_DATA_DIR"
    return 0
  fi
  echo "The Agent volume is not mounted at /Volumes/Agent." >&2
  echo "Plug in the APFS drive named Agent, then run this again." >&2
  echo "Or set BAKUGAN_DATA_DIR=/Volumes/<Drive>/agent" >&2
  echo "Nothing was written to the internal disk." >&2
  exit 1
}

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
    echo "Plug in the Agent drive and use /Volumes/Agent/agent, or set BAKUGAN_DATA_DIR to another mounted /Volumes path." >&2
    exit 1
  fi
  local rest="${dir#/Volumes/}"
  local volume="${rest%%/*}"
  if [[ -z "$volume" || "$volume" == "$dir" ]]; then
    echo "BAKUGAN_DATA_DIR must look like /Volumes/Agent/agent." >&2
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
    echo "Plug in the Agent drive (/Volumes/Agent), then run this again." >&2
    echo "Nothing was written to the internal disk." >&2
    exit 1
  fi
  mkdir -p "$dir"
}
