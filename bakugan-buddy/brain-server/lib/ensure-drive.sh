#!/usr/bin/env bash
# Refuse to use the internal disk. BAKUGAN_DATA_DIR must be a mounted /Volumes path.
# Default data root: the APFS volume Agent. Override with BAKUGAN_DATA_DIR.
# Exits if Agent is not mounted and no override was set.
# Preyas weights, memory, and history stay in BAKUGAN_DATA_DIR.
# On this Mac that is /Volumes/Agent/BakuganBuddy.
# The gateway venv and secrets/.env stay in /Volumes/Agent/agent.
# Do not rewrite one path into the other.
BUDDY_DATA_DIR="/Volumes/Agent/BakuganBuddy"
AGENT_GATEWAY_DIR="/Volumes/Agent/agent"

preyas_data_present() {
  local d="${1%/}"
  [[ -n "$d" && -d "$d" ]] || return 1
  [[ -f "$d/memory/facts.sqlite" || -f "$d/memory/room.jsonl" || -f "$d/brain.json" ]] && return 0
  [[ -d "$d/models" ]] || return 1
  find "$d/models" -name '*.gguf' -print -quit 2>/dev/null | grep -q .
}

# Where llama, memory, and history are read. Prefer a folder that already has them.
preyas_data_dir() {
  local configured="${1%/}"
  if preyas_data_present "$configured"; then
    printf '%s\n' "$configured"
    return
  fi
  if preyas_data_present "$BUDDY_DATA_DIR"; then
    printf '%s\n' "$BUDDY_DATA_DIR"
    return
  fi
  printf '%s\n' "$configured"
}

# Secrets and the LiteLLM venv. Not the Preyas model folder.
gateway_root() {
  if [[ -n "${AGENT_DRIVE_ROOT:-}" ]]; then
    local set="${AGENT_DRIVE_ROOT%/}"
    if [[ "$set" != "$BUDDY_DATA_DIR" ]]; then
      printf '%s\n' "$set"
      return
    fi
  fi
  printf '%s\n' "$AGENT_GATEWAY_DIR"
}

split_agent_roots() {
  local env_file="${1:-}"
  local configured="${BAKUGAN_DATA_DIR:-}"
  local data=""
  data="$(preyas_data_dir "$configured")"
  if [[ -n "$data" && -n "$configured" && "$data" != "${configured%/}" ]]; then
    echo "Preyas models and memory are in $data."
    echo "Keeping that path. Gateway secrets and venv stay in $AGENT_GATEWAY_DIR."
    BAKUGAN_DATA_DIR="$data"
  fi
  export BAKUGAN_DATA_DIR
  AGENT_DRIVE_ROOT="$(gateway_root)"
  export AGENT_DRIVE_ROOT
  if [[ -n "$env_file" && -f "$env_file" && -n "${BAKUGAN_DATA_DIR:-}" ]]; then
    local current=""
    current="$(awk 'index($0, "BAKUGAN_DATA_DIR=")==1 {print substr($0, 18); exit}' "$env_file")"
    if [[ "$current" != "$BAKUGAN_DATA_DIR" ]]; then
      local tmp
      tmp="$(mktemp)"
      awk -v v="$BAKUGAN_DATA_DIR" 'BEGIN{done=0} index($0, "BAKUGAN_DATA_DIR=")==1 {print "BAKUGAN_DATA_DIR=" v; done=1; next} {print} END{if(!done) print "BAKUGAN_DATA_DIR=" v}' "$env_file" >"$tmp"
      mv "$tmp" "$env_file"
      echo "Updated brain.env data root to $BAKUGAN_DATA_DIR."
    fi
  fi
}

resolve_bakugan_data_dir() {
  if [[ -n "${BAKUGAN_DATA_DIR:-}" ]]; then
    split_agent_roots
    return 0
  fi
  if preyas_data_present "$BUDDY_DATA_DIR"; then
    BAKUGAN_DATA_DIR="$BUDDY_DATA_DIR"
    export BAKUGAN_DATA_DIR
    echo "Data root: $BAKUGAN_DATA_DIR"
    split_agent_roots
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
