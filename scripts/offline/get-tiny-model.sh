#!/usr/bin/env bash
# Download the optional tiny off-grid model (Qwen3.5 0.8B, Q4_K_M).
#
# This is NOT the default model. Qwen3-8B stays the default; the tiny tier is
# only used after you choose "Tiny model (off-grid)" in the model switcher.
# The file is ~530 MB and lives on the Agent drive, never in git, and nothing
# here runs in CI.
#
#   scripts/offline/get-tiny-model.sh
#   PREYAS_TINY_QWEN_QUANT=Q5_K_M scripts/offline/get-tiny-model.sh
#   PREYAS_TINY_QWEN_REPO=some/repo PREYAS_TINY_QWEN_FILE=some-file.gguf \
#     scripts/offline/get-tiny-model.sh
set -euo pipefail

OUT_DIR="${PREYAS_MODELS_DIR:-/Volumes/Agent/agent/models}"
# The closest tiny Qwen chat model with a published GGUF: unsloth ships
# Qwen3.5-0.8B (a general instruct chat model) in every common quantization.
REPO="${PREYAS_TINY_QWEN_REPO:-unsloth/Qwen3.5-0.8B-GGUF}"
QUANT="${PREYAS_TINY_QWEN_QUANT:-Q4_K_M}"
FILE="${PREYAS_TINY_QWEN_FILE:-Qwen3.5-0.8B-${QUANT}.gguf}"

case "$FILE" in
  *.gguf) ;;
  *) echo "Refusing a non-GGUF filename: $FILE" >&2; exit 2 ;;
esac

mkdir -p "$OUT_DIR"
OUT="$OUT_DIR/$FILE"
URL="https://huggingface.co/${REPO}/resolve/main/${FILE}"

if [[ -f "$OUT" ]] && head -c 4 "$OUT" 2>/dev/null | grep -q GGUF; then
  echo "Already downloaded: $OUT"
  exit 0
fi

echo "Downloading $REPO/$FILE (resumable)"
# --continue-at - keeps a partial file across a dropped connection.
if ! curl -fL --retry 3 --retry-delay 2 --continue-at - "$URL" -o "$OUT.part"; then
  echo "Download failed; a later run resumes from $OUT.part" >&2
  exit 1
fi

# A real GGUF starts with the bytes "GGUF". This catches an HTML error page
# saved with a .gguf name far more cheaply than loading it.
if ! head -c 4 "$OUT.part" | grep -q GGUF; then
  echo "Downloaded file is not a GGUF; removing it" >&2
  rm -f "$OUT.part"
  exit 1
fi

mv "$OUT.part" "$OUT"
echo "Ready: $OUT"
