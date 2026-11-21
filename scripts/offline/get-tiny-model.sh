#!/usr/bin/env bash
set -euo pipefail

OUT_DIR="${PREYAS_MODELS_DIR:-/Volumes/Agent/agent/models}"
REPO="${PREYAS_TINY_QWEN_REPO:-unsloth/Qwen3.5-0.8B-GGUF}"
QUANT="${PREYAS_TINY_QWEN_QUANT:-Q4_K_M}"
FILE="Qwen3.5-0.8B-${QUANT}.gguf"
OUT="$OUT_DIR/$FILE"

mkdir -p "$OUT_DIR"
URL="https://huggingface.co/${REPO}/resolve/main/${FILE}"

echo "Downloading $REPO/$FILE"
curl -L --fail --retry 3 --continue-at - "$URL" -o "$OUT"
echo "Ready: $OUT"
