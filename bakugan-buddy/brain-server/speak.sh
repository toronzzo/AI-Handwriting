#!/usr/bin/env bash
# Speak one line with the Piper voice on the Agent drive.
#   ./speak.sh "The window's mine."
# Uses the Python 3.11 venv. The system python3.9 is not used.
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

text="${1:-}"
if [[ -z "$text" ]]; then
  echo "usage: ./speak.sh \"line\"" >&2
  exit 2
fi
out="${2:-$BAKUGAN_DATA_DIR/logs/last-say.wav}"
mkdir -p "$(dirname "$out")"
voice="${PIPER_VOICE:-$BAKUGAN_DATA_DIR/models/piper-voices/en_US-lessac-medium.onnx}"
if [[ -x "${PIPER_PYTHON:-}" ]]; then
  "$PIPER_PYTHON" - "$voice" "$out" "$text" <<'PY'
import sys
import wave
voice_path, out_path, text = sys.argv[1], sys.argv[2], sys.argv[3]
from piper import PiperVoice
voice = PiperVoice.load(voice_path)
with wave.open(out_path, "wb") as wav:
    if hasattr(voice, "synthesize_wav"):
        voice.synthesize_wav(text, wav)
    else:
        voice.synthesize(text, wav)
print(out_path)
PY
  exit 0
fi
piper_bin="$BAKUGAN_DATA_DIR/models/piper/piper"
if [[ -x "$piper_bin" ]]; then
  printf '%s\n' "$text" | "$piper_bin" --model "$voice" --output_file "$out"
  echo "$out"
  exit 0
fi
echo "No Piper venv or binary. Run ./setup-all.sh" >&2
exit 1
