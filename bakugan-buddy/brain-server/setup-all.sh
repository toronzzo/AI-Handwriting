#!/usr/bin/env bash
# One idempotent setup for this Mac: brain + speech-to-text + text-to-speech.
#
# Machine this was written for:
#   MacBook Pro M1 Pro, 16 GB, macOS 14.6
#   brew, git, gh, node 22, llama-server (build 11867), Xcode CLT 16.2
#   system python3.9 (too old for piper-tts)
#   no ffmpeg, whisper.cpp, ollama, docker, or full Xcode
#   external APFS volume Agent at /Volumes/Agent (~468 GiB)
#
# Does not install Docker, Ollama, or full Xcode. Does not replace llama-server
# when it is already on PATH. Python venvs and model files go on the drive.
#
#   ./setup-all.sh
#   ./setup-all.sh --model fast
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=lib/ensure-drive.sh
source "$ROOT/lib/ensure-drive.sh"

MODEL_ARGS=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    --model)
      MODEL_ARGS+=(--model "${2:-}")
      shift 2
      ;;
    -h|--help)
      echo "usage: ./setup-all.sh [--model fast|default|default-q5|large|all]"
      echo "Installs python@3.11, ffmpeg, and whisper-cpp with Homebrew."
      echo "Downloads the brain GGUF, a Whisper model, and a Piper voice onto /Volumes/Agent/agent."
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      exit 2
      ;;
  esac
done

resolve_bakugan_data_dir
ensure_bakugan_drive

if ! command -v brew >/dev/null 2>&1; then
  echo "Homebrew is not installed. Install it from https://brew.sh and run this again." >&2
  exit 1
fi

mkdir -p \
  "$BAKUGAN_DATA_DIR/models/whisper" \
  "$BAKUGAN_DATA_DIR/models/piper-voices" \
  "$BAKUGAN_DATA_DIR/venvs" \
  "$BAKUGAN_DATA_DIR/logs" \
  "$BAKUGAN_DATA_DIR/cache" \
  "$BAKUGAN_DATA_DIR/memory"

have_formula() {
  brew list --formula "$1" >/dev/null 2>&1
}

ensure_formula() {
  local formula="$1"
  if have_formula "$formula"; then
    echo "have $formula"
    return 0
  fi
  echo "brew install $formula"
  brew install "$formula"
}

# llama-server build 11867 is already installed. Do not brew-upgrade it.
if command -v llama-server >/dev/null 2>&1; then
  echo "have llama-server: $(llama-server --version 2>&1 | head -n 1 || true)"
else
  echo "llama-server is missing. Installing llama.cpp with Homebrew."
  ensure_formula llama.cpp
fi

ensure_formula python@3.11
ensure_formula ffmpeg
ensure_formula whisper-cpp
ensure_formula espeak-ng

PY311="$(brew --prefix python@3.11)/bin/python3.11"
if [[ ! -x "$PY311" ]]; then
  echo "python@3.11 did not land at $PY311" >&2
  exit 1
fi
echo "python: $("$PY311" -c 'import sys; print(".".join(map(str, sys.version_info[:3])))')"

install_piper_binary() {
  local dest="$BAKUGAN_DATA_DIR/models/piper/piper"
  if [[ -x "$dest" ]]; then
    echo "have $dest"
    return 0
  fi
  local url="https://github.com/rhasspy/piper/releases/download/2023.11.14-2/piper_macos_aarch64.tar.gz"
  local tar="$BAKUGAN_DATA_DIR/models/piper_macos_aarch64.tar.gz"
  mkdir -p "$BAKUGAN_DATA_DIR/models/piper"
  if [[ ! -f "$tar" ]]; then
    curl -L --fail --retry 3 -o "$tar.part" "$url"
    mv "$tar.part" "$tar"
  fi
  tar -xzf "$tar" -C "$BAKUGAN_DATA_DIR/models/piper" --strip-components=1
  chmod +x "$dest" || true
}

VENV="$BAKUGAN_DATA_DIR/venvs/tts"
if [[ ! -x "$VENV/bin/python" ]]; then
  echo "creating venv $VENV"
  "$PY311" -m venv "$VENV"
else
  echo "have venv $VENV"
fi
if ! "$VENV/bin/python" -c "import piper" >/dev/null 2>&1; then
  "$VENV/bin/python" -m pip install -U pip
  if ! "$VENV/bin/python" -m pip install "piper-tts>=1.2.0" "kokoro-onnx>=0.4.0" soundfile; then
    echo "piper-tts wheel failed. Falling back to the macOS Piper binary on the drive."
    install_piper_binary
  fi
else
  echo "have piper-tts in $VENV"
fi

fetch() {
  local url="$1" dest="$2"
  if [[ -f "$dest" ]]; then
    echo "have $(basename "$dest")"
    return 0
  fi
  mkdir -p "$(dirname "$dest")"
  echo "GET $url"
  curl -L --fail --retry 3 -C - -o "$dest.part" "$url"
  mv "$dest.part" "$dest"
}

WHISPER_MODEL="$BAKUGAN_DATA_DIR/models/whisper/ggml-base.bin"
fetch "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin" "$WHISPER_MODEL"
# Optional accuracy model. The base model is the default so STT stays small next to the 8B brain.
fetch "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.bin" \
  "$BAKUGAN_DATA_DIR/models/whisper/ggml-small.bin"

fetch "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/kokoro-v1.0.onnx" \
  "$BAKUGAN_DATA_DIR/models/kokoro/kokoro-v1.0.onnx"
fetch "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/voices-v1.0.bin" \
  "$BAKUGAN_DATA_DIR/models/kokoro/voices-v1.0.bin"

fetch_voice() {
  local lang="$1" folder="$2" name="$3" quality="$4" id="$5"
  local base="https://huggingface.co/rhasspy/piper-voices/resolve/main/${lang}/${folder}/${name}/${quality}"
  fetch "${base}/${id}.onnx" "$BAKUGAN_DATA_DIR/models/piper-voices/${id}.onnx"
  fetch "${base}/${id}.onnx.json" "$BAKUGAN_DATA_DIR/models/piper-voices/${id}.onnx.json"
}
# Ryan high: energetic, published Piper voice. Dmitri: Russian Piper voice. Not a show recording.
fetch_voice en en_US ryan high en_US-ryan-high
fetch_voice ru ru_RU dmitri medium ru_RU-dmitri-medium

# Brain GGUF. setup.sh skips a file that is already on the drive.
"$ROOT/setup.sh" "${MODEL_ARGS[@]}"

WHISPER_BIN="$(command -v whisper-cli || command -v whisper-cpp || true)"
ENV_FILE="$ROOT/brain.env"
touch "$ENV_FILE"
put_env() {
  local key="$1" val="$2"
  if grep -q "^${key}=" "$ENV_FILE"; then
    # macOS and GNU sed differ. Rewrite the line in bash.
    local tmp
    tmp="$(mktemp)"
    awk -v k="$key" -v v="$val" 'BEGIN{done=0} index($0, k"=")==1 {print k"="v; done=1; next} {print} END{if(!done) print k"="v}' "$ENV_FILE" >"$tmp"
    mv "$tmp" "$ENV_FILE"
  else
    printf '%s=%s\n' "$key" "$val" >>"$ENV_FILE"
  fi
}
put_env KOKORO_MODEL "$BAKUGAN_DATA_DIR/models/kokoro/kokoro-v1.0.onnx"
put_env KOKORO_VOICES "$BAKUGAN_DATA_DIR/models/kokoro/voices-v1.0.bin"
put_env PIPER_PYTHON "$VENV/bin/python"
put_env PIPER_VOICE "$BAKUGAN_DATA_DIR/models/piper-voices/en_US-ryan-high.onnx"
put_env PIPER_VOICE_RU "$BAKUGAN_DATA_DIR/models/piper-voices/ru_RU-dmitri-medium.onnx"
put_env WHISPER_MODEL "$WHISPER_MODEL"
put_env WHISPER_BIN "$WHISPER_BIN"
put_env FFMPEG "$(command -v ffmpeg)"

echo ""
echo "Ready."
echo "  brain:   ./start.sh"
echo "  speak:   ./speak.sh \"Corner's mine.\""
echo "  hear:    ./transcribe.sh path/to/audio.wav"
echo "System python3.9 was not used. Docker and full Xcode were not required."
