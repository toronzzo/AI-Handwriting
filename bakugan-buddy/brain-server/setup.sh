#!/usr/bin/env bash
# One-time Mac setup. Models go on the external drive, never the internal disk.
#   ./setup.sh                  # ask for the volume, download the default 8B
#   ./setup.sh --model fast
#   ./setup.sh --model large    # 14B Q4, prints a 16 GB warning
#   BAKUGAN_DATA_DIR=/Volumes/Drive/BakuganBuddy ./setup.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=lib/ensure-drive.sh
source "$ROOT/lib/ensure-drive.sh"

MODEL="default"
WITH_LARGE=0
POSITIONAL=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    --model)
      MODEL="${2:-}"
      shift 2
      ;;
    --with-large)
      WITH_LARGE=1
      shift
      ;;
    -h|--help)
      echo "usage: ./setup.sh [--model fast|default|default-q5|large|all] [/Volumes/Drive/BakuganBuddy]"
      exit 0
      ;;
    *)
      POSITIONAL+=("$1")
      shift
      ;;
  esac
done

if [[ -n "${POSITIONAL[0]:-}" ]]; then
  BAKUGAN_DATA_DIR="${POSITIONAL[0]}"
fi

list_volumes() {
  local name
  [[ -d /Volumes ]] || return 0
  for name in /Volumes/*; do
    [[ -d "$name" ]] || continue
    name="$(basename "$name")"
    case "$name" in
      "Macintosh HD"*|Recovery|Preboot|Update|VM|com.apple*) continue ;;
    esac
    if mount | grep -F " on /Volumes/$name " >/dev/null 2>&1; then
      printf '%s\n' "$name"
    fi
  done
}

if [[ -z "${BAKUGAN_DATA_DIR:-}" ]]; then
  volumes=()
  while IFS= read -r name; do
    [[ -n "$name" ]] && volumes+=("$name")
  done < <(list_volumes || true)
  if [[ ${#volumes[@]} -eq 0 ]]; then
    echo "No external drive is mounted under /Volumes." >&2
    echo "Plug in the drive (about 500 GB is plenty), then run ./setup.sh again." >&2
    echo "Nothing was written to the internal disk." >&2
    exit 1
  fi
  echo "External volumes:"
  printf '  /Volumes/%s\n' "${volumes[@]}"
  pick="${volumes[0]}"
  if [[ ${#volumes[@]} -gt 1 && -t 0 ]]; then
    read -r -p "Drive name [${pick}]: " typed
    if [[ -n "$typed" ]]; then pick="$typed"; fi
  elif [[ ${#volumes[@]} -gt 1 ]]; then
    echo "More than one volume. Re-run with BAKUGAN_DATA_DIR=/Volumes/<Drive>/BakuganBuddy" >&2
    exit 1
  fi
  BAKUGAN_DATA_DIR="/Volumes/${pick}/BakuganBuddy"
  echo "Data root: $BAKUGAN_DATA_DIR"
fi

export BAKUGAN_DATA_DIR
ensure_bakugan_drive

mkdir -p \
  "$BAKUGAN_DATA_DIR/models" \
  "$BAKUGAN_DATA_DIR/hf" \
  "$BAKUGAN_DATA_DIR/logs" \
  "$BAKUGAN_DATA_DIR/memory" \
  "$BAKUGAN_DATA_DIR/training" \
  "$BAKUGAN_DATA_DIR/rl"

cat > "$BAKUGAN_DATA_DIR/README.txt" <<EOF
Bakugan Buddy data. Safe to keep on this external drive.
  models/    GGUF weights (not in git)
  hf/        Hugging Face cache (HF_HOME)
  logs/      llama-server logs
  memory/    room memory exports from the phone
  training/  future training data
  rl/        future RL checkpoints
EOF

cat > "$ROOT/brain.env" <<EOF
BAKUGAN_DATA_DIR=$BAKUGAN_DATA_DIR
HF_HOME=$BAKUGAN_DATA_DIR/hf
HUGGINGFACE_HUB_CACHE=$BAKUGAN_DATA_DIR/hf/hub
EOF

if ! command -v llama-server >/dev/null 2>&1; then
  if command -v brew >/dev/null 2>&1; then
    echo "Installing llama.cpp with Homebrew (llama-server)..."
    brew install llama.cpp
  else
    echo "llama-server is not on PATH and Homebrew is missing." >&2
    echo "Install Homebrew, then: brew install llama.cpp" >&2
    exit 1
  fi
fi

download_one() {
  local id="$1"
  local meta file repo url dest
  meta="$(node -e '
    const m = require(process.argv[1]);
    const t = m[process.argv[2]];
    if (!t) process.exit(2);
    process.stdout.write([t.repo, t.file, t.warn ? "1" : "0", t.label].join("\t"));
  ' "$ROOT/models.json" "$id")" || {
    echo "Unknown model id: $id" >&2
    echo "Choose fast, default, default-q5, or large." >&2
    exit 1
  }
  IFS=$'\t' read -r repo file warn label <<<"$meta"
  if [[ "$warn" == "1" ]]; then
    echo ""
    echo "WARNING: $label uses about 11 GB of the 16 GB unified memory."
    echo "macOS will swap. Preyas will answer, slowly. This is optional."
    echo ""
  fi
  dest="$BAKUGAN_DATA_DIR/models/$file"
  url="https://huggingface.co/${repo}/resolve/main/${file}"
  if [[ -f "$dest" ]]; then
    echo "have $file"
    return 0
  fi
  echo "GET $url"
  echo "  -> $dest"
  curl -L --fail --retry 3 -C - -o "$dest.part" "$url"
  mv "$dest.part" "$dest"
}

if [[ "$MODEL" == "all" ]]; then
  download_one fast
  download_one default
  download_one default-q5
  if [[ "$WITH_LARGE" == "1" ]]; then
    download_one large
  else
    echo "Skipped the 14B tier. Add it later with: ./setup.sh --model large"
  fi
  MODEL="default"
else
  download_one "$MODEL"
fi

node -e '
  const fs = require("fs");
  const path = process.argv[1];
  const id = process.argv[2];
  let prev = {};
  try { prev = JSON.parse(fs.readFileSync(path, "utf8")); } catch {}
  prev.model = id;
  prev.port = prev.port || 8788;
  fs.writeFileSync(path, JSON.stringify(prev, null, 2) + "\n");
' "$BAKUGAN_DATA_DIR/brain.json" "$MODEL"

echo ""
echo "Active model: $MODEL"
echo "Start the brain with: ./start.sh"
echo "Switch later with:    ./use-model.sh fast|default|default-q5|large"
