#!/usr/bin/env bash
# Download offline models into bakugan-buddy/studio/models (gitignored).
# Usage:
#   ./download-models.sh           # piper voices + sherpa zipformer (no 2GB GGUF)
#   ./download-models.sh --llm     # also Qwen2.5-3B-Instruct Q4_K_M
#   ./download-models.sh --all
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
MODELS="$ROOT/models"
mkdir -p "$MODELS"

CHECKSUMS="$ROOT/checksums.sha256"

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
  echo "$expected  $dest" | sha256sum -c -
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
    echo "== Piper binary (linux x86_64) =="
    TMP="$MODELS/piper.tgz"
    fetch "https://github.com/rhasspy/piper/releases/download/2023.11.14-2/piper_linux_x86_64.tar.gz" "$TMP" || true
    if [[ -f "$TMP" ]]; then
      mkdir -p "$MODELS/piper"
      tar -xzf "$TMP" -C "$MODELS/piper" --strip-components=1 || tar -xzf "$TMP" -C "$MODELS/piper"
      chmod +x "$MODELS/piper/piper" 2>/dev/null || true
    else
      echo "NOTE: download piper binary manually if not linux x86_64, or apt-install none — espeak-ng is the fallback."
    fi
  fi
fi

if [[ "$WANT_STT" == 1 ]]; then
  echo "== sherpa-onnx streaming zipformer EN =="
  # Official k2-fsa streaming zipformer (int8) — Apache-2.0
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
  echo "Install Node bindings in studio/: npm i sherpa-onnx  (optional native)"
fi

if [[ "$WANT_LLM" == 1 ]]; then
  echo "== Qwen2.5-3B-Instruct Q4_K_M (~2GB) =="
  fetch \
    "https://huggingface.co/Qwen/Qwen2.5-3B-Instruct-GGUF/resolve/main/qwen2.5-3b-instruct-q4_k_m.gguf" \
    "$MODELS/qwen2.5-3b-instruct-q4_k_m.gguf"
  echo "Start llama.cpp: llama-server -m $MODELS/qwen2.5-3b-instruct-q4_k_m.gguf --port 8080 --host 127.0.0.1"
fi

echo "Done. Models in $MODELS"
echo "Then: cd studio && npm start"
echo "llama-server must be running separately for /v1/chat (or health.llm.ready=false)."
