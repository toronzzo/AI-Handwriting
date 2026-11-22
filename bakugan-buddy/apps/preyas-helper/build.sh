#!/usr/bin/env bash
# Build Preyas Helper.app for macOS 14 or newer.
# Linux CI does not compile Swift. This script exits 0 there so a syntax
# check (bash -n) is the only thing the required CI job needs.
set -euo pipefail
cd "$(dirname "$0")"

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "Preyas Helper is a macOS app (ScreenCaptureKit). Skipping the build on $(uname -s)." >&2
  exit 0
fi

if ! command -v swiftc >/dev/null 2>&1; then
  echo "swiftc was not found. Install Xcode or the Swift 6 command line tools." >&2
  exit 1
fi
if ! xcrun --sdk macosx --show-sdk-path >/dev/null 2>&1; then
  echo "The macOS SDK was not found. Install the Xcode command line tools." >&2
  exit 1
fi

SDK="$(xcrun --sdk macosx --show-sdk-path)"
ARCH="$(uname -m)"
case "$ARCH" in
  arm64|x86_64) ;;
  *)
    echo "Unsupported architecture: $ARCH" >&2
    exit 1
    ;;
esac

ROOT="$(pwd)"
APP="$ROOT/dist/Preyas Helper.app"
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS"
cp "$ROOT/Info.plist" "$APP/Contents/Info.plist"

swiftc \
  -parse-as-library \
  -module-name PreyasHelper \
  -swift-version 6 \
  -O \
  -target "${ARCH}-apple-macosx14.0" \
  -sdk "$SDK" \
  -framework AppKit \
  -framework SwiftUI \
  -framework ScreenCaptureKit \
  -framework AVFoundation \
  -framework Speech \
  -framework Carbon \
  -framework CoreGraphics \
  -o "$APP/Contents/MacOS/Preyas Helper" \
  "$ROOT/Sources/"*.swift

echo "Built $APP"
