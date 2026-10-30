#!/usr/bin/env bash
# Turn a recording into text with the Whisper model on the Agent drive.
#   ./transcribe.sh take.m4a
# ffmpeg (Homebrew) resamples to 16 kHz mono. No Docker.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
if [[ ! -f "$ROOT/brain.env" ]]; then
  echo "Run ./setup-all.sh first." >&2
  exit 1
fi
set -a
# shellcheck disable=SC1091
source "$ROOT/brain.env"
set +a
# shellcheck source=lib/ensure-drive.sh
source "$ROOT/lib/ensure-drive.sh"
ensure_bakugan_drive

in="${1:-}"
if [[ -z "$in" || ! -f "$in" ]]; then
  echo "usage: ./transcribe.sh audio-file" >&2
  exit 2
fi
bin="${WHISPER_BIN:-}"
if [[ -z "$bin" ]]; then
  bin="$(command -v whisper-cli || command -v whisper-cpp || true)"
fi
if [[ -z "$bin" ]]; then
  echo "whisper-cli is missing. Run ./setup-all.sh" >&2
  exit 1
fi
ffmpeg_bin="${FFMPEG:-ffmpeg}"
wav="$BAKUGAN_DATA_DIR/logs/last-hear.wav"
mkdir -p "$BAKUGAN_DATA_DIR/logs"
"$ffmpeg_bin" -y -i "$in" -ar 16000 -ac 1 -c:a pcm_s16le "$wav" >/dev/null 2>&1
"$bin" -m "$WHISPER_MODEL" -f "$wav" -l en --no-timestamps
