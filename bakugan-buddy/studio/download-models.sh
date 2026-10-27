#!/usr/bin/env bash
# Download offline models into bakugan-buddy/studio/models (gitignored).
# Usage:
#   ./download-models.sh           # TTS voices + STT (skip ~2GB GGUF)
#   ./download-models.sh --llm     # also Qwen2.5-3B-Instruct Q4_K_M
#   ./download-models.sh --all
#
# macOS arm64 (M1/M2/M3): prefers piper_macos_aarch64 binary, else pip piper-tts
#                         in models/venv, else documents sherpa-onnx TTS fallback.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
MODELS="$ROOT/models"
mkdir -p "$MODELS"

CHECKSUMS="$ROOT/checksums.sha256"
OS="$(uname -s | tr '[:upper:]' '[:lower:]')"
ARCH="$(uname -m)"

sha256_cmd() {
  if command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$@"
  elif command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$@"
  else
    echo "ERROR: need shasum or sha256sum" >&2
    return 1
  fi
}

verify() {
  local dest="$1"
  local rel="${dest#"$MODELS"/}"
  [[ -f "$CHECKSUMS" ]] || return 0
  local expected
  expected="$(awk -v f="$rel" '$2 == f { print $1; exit }' "$CHECKSUMS" || true)"
  if [[ -z "$expected" ]]; then
    echo "WARN: no checksum listed for $rel"
    return 0
  fi
  local actual
  actual="$(sha256_cmd "$dest" | awk '{print $1}')"
  if [[ "$actual" != "$expected" ]]; then
    echo "ERROR: checksum mismatch for $rel" >&2
    echo "  expected $expected" >&2
    echo "  actual   $actual" >&2
    return 1
  fi
  echo "OK checksum $rel"
}

fetch() {
  local url="$1" dest="$2"
  mkdir -p "$(dirname "$dest")"
  if [[ -f "$dest" ]]; then
    echo "have $(basename "$dest")"
    verify "$dest"
    return 0
  fi
  echo "GET $url"
  curl -L --fail --retry 3 -C - -o "$dest.part" "$url"
  mv "$dest.part" "$dest"
  verify "$dest"
}

WANT_LLM=0
WANT_STT=1
WANT_TTS=1
for a in "$@"; do
  case "$a" in
    --llm|--all) WANT_LLM=1 ;;
    --no-stt) WANT_STT=0 ;;
    --no-tts) WANT_TTS=0 ;;
  esac
done

install_piper_tts_pip() {
  local venv="$MODELS/venv"
  if [[ ! -x "$venv/bin/python" ]]; then
    echo "== Python venv for piper-tts =="
    python3 -m venv "$venv"
  fi
  # shellcheck disable=SC1091
  source "$venv/bin/activate"
  pip install -q --upgrade pip
  pip install -q "piper-tts>=1.2.0" || pip install -q piper-tts
  python -c "import piper; print('piper-tts OK', piper.__file__)"
  deactivate || true
  # marker for paths.mjs
  echo "pip" > "$MODELS/piper-engine.txt"
}

install_piper_binary() {
  local url="" name=""
  case "${OS}-${ARCH}" in
    darwin-arm64|darwin-aarch64)
      url="https://github.com/rhasspy/piper/releases/download/2023.11.14-2/piper_macos_aarch64.tar.gz"
      name="piper_macos_aarch64.tar.gz"
      ;;
    darwin-x86_64)
      url="https://github.com/rhasspy/piper/releases/download/2023.11.14-2/piper_macos_x64.tar.gz"
      name="piper_macos_x64.tar.gz"
      ;;
    linux-x86_64|linux-amd64)
      url="https://github.com/rhasspy/piper/releases/download/2023.11.14-2/piper_linux_x86_64.tar.gz"
      name="piper_linux_x86_64.tar.gz"
      ;;
    *)
      return 1
      ;;
  esac
  echo "== Piper binary ($name) =="
  local tmp="$MODELS/$name"
  fetch "$url" "$tmp" || return 1
  mkdir -p "$MODELS/piper"
  tar -xzf "$tmp" -C "$MODELS/piper" --strip-components=1 2>/dev/null \
    || tar -xzf "$tmp" -C "$MODELS/piper"
  chmod +x "$MODELS/piper/piper" 2>/dev/null || true
  # On macOS the binary may sit nested
  if [[ ! -x "$MODELS/piper/piper" ]]; then
    local found
    found="$(find "$MODELS/piper" -type f -name piper | head -1 || true)"
    if [[ -n "$found" ]]; then
      ln -sfn "$found" "$MODELS/piper/piper"
      chmod +x "$found"
    fi
  fi
  if [[ -x "$MODELS/piper/piper" ]]; then
    echo "binary" > "$MODELS/piper-engine.txt"
    return 0
  fi
  return 1
}

if [[ "$WANT_TTS" == 1 ]]; then
  echo "== Piper voices =="
  BASE="https://huggingface.co/rhasspy/piper-voices/resolve/main/en"
  fetch "$BASE/en_US/lessac/medium/en_US-lessac-medium.onnx" \
    "$MODELS/piper-voices/en_US-lessac-medium.onnx"
  fetch "$BASE/en_US/lessac/medium/en_US-lessac-medium.onnx.json" \
    "$MODELS/piper-voices/en_US-lessac-medium.onnx.json"
  fetch "$BASE/en_US/ryan/medium/en_US-ryan-medium.onnx" \
    "$MODELS/piper-voices/en_US-ryan-medium.onnx"
  fetch "$BASE/en_US/ryan/medium/en_US-ryan-medium.onnx.json" \
    "$MODELS/piper-voices/en_US-ryan-medium.onnx.json"

  if [[ ! -x "$MODELS/piper/piper" ]]; then
    if ! install_piper_binary; then
      echo "NOTE: no Piper binary for ${OS}-${ARCH}; trying pip piper-tts"
      if install_piper_tts_pip; then
        echo "Using models/venv piper-tts (warm worker will use Python API)."
      else
        echo "NOTE: Piper unavailable. Studio can fall back to sherpa-onnx TTS if installed,"
        echo "      or espeak-ng. On M1: python3 -m venv models/venv && pip install piper-tts"
      fi
    fi
  else
    echo "binary" > "$MODELS/piper-engine.txt"
  fi
fi

if [[ "$WANT_STT" == 1 ]]; then
  echo "== sherpa-onnx streaming zipformer EN =="
  SHERPA="$MODELS/sherpa-zipformer"
  mkdir -p "$SHERPA"
  BASE="https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models"
  TAR="$MODELS/sherpa-zipformer.tar.bz2"
  fetch "$BASE/sherpa-onnx-streaming-zipformer-en-2023-06-26.tar.bz2" "$TAR" || true
  if [[ -f "$TAR" && ! -f "$SHERPA/tokens.txt" ]]; then
    tar -xjf "$TAR" -C "$MODELS"
    FOUND="$(find "$MODELS" -maxdepth 2 -type d -name 'sherpa-onnx-streaming-zipformer-en*' | head -1)"
    if [[ -n "$FOUND" && "$FOUND" != "$SHERPA" ]]; then
      cp -a "$FOUND"/. "$SHERPA"/
    fi
  fi
  echo "Optional: pip install sherpa-onnx  (STT Node/Python bindings)"
fi

if [[ "$WANT_LLM" == 1 ]]; then
  echo "== Qwen2.5-3B-Instruct Q4_K_M (~2.1GB) =="
  fetch \
    "https://huggingface.co/Qwen/Qwen2.5-3B-Instruct-GGUF/resolve/main/qwen2.5-3b-instruct-q4_k_m.gguf" \
    "$MODELS/qwen2.5-3b-instruct-q4_k_m.gguf"
  echo "Start llama.cpp on Apple Silicon:"
  echo "  llama-server -m $MODELS/qwen2.5-3b-instruct-q4_k_m.gguf --host 127.0.0.1 --port 8080 -c 4096"
fi

echo "Done. Models in $MODELS"
echo "Then: cd studio && npm start"
echo "Bench: node scripts/bench-sidecar.mjs  (see docs/BENCH.md)"
