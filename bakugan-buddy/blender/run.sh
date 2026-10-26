#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
BLENDER="${BLENDER:-$ROOT/tools/blender/blender-4.2.5-linux-x64/blender}"
if [[ ! -x "$BLENDER" ]]; then
  echo "Set BLENDER to your Blender 4.x binary (got: $BLENDER)" >&2
  exit 1
fi
cmd="${1:-help}"
shift || true
case "$cmd" in
  build)
    exec "$BLENDER" --background --python "$ROOT/bakugan-buddy/blender/scripts/build_ripple.py" "$@"
    ;;
  drive)
    blend="$ROOT/bakugan-buddy/blender/out/ripple_rigged.blend"
    [[ -f "$blend" ]] || { echo "Run: $0 build" >&2; exit 1; }
    exec "$BLENDER" --background "$blend" --python "$ROOT/bakugan-buddy/blender/scripts/ai_driver.py" -- "$@"
    ;;
  *)
    echo "Usage: $0 build | drive [--react '[mood] line' --render ...]"
    exit 1
    ;;
esac
