#!/usr/bin/env bash
# Build Preyas Helper.app for macOS 14 or newer.
# Linux CI does not compile Swift. This script exits 0 there so a syntax
# check (bash -n) is the only thing the required CI job needs.
set -euo pipefail
cd "$(dirname "$0")"

echo "Building Preyas Helper (about 1 minute)..."

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

# Command Line Tools 16 ships usr/include/swift/bridging.modulemap, and the
# parent usr/include/module.modulemap points at it with `extern module`.
# Clang also loads a file named module.modulemap by that name alone. An
# upgrade from Command Line Tools 15 leaves the old
# usr/include/swift/module.modulemap in place, and that copy still defines
# SwiftBridging, so Foundation fails with "redefinition of module
# SwiftBridging". Move the leftover. bridging.modulemap is the live file.
stop_if_swift_bridging_is_defined_twice() {
  local dir="/Library/Developer/CommandLineTools/usr/include/swift"
  local legacy="$dir/module.modulemap"
  local current="$dir/bridging.modulemap"
  if swift_bridging_module_defined "$legacy" && swift_bridging_module_defined "$current"; then
    cat >&2 <<'EOF'
Swift stopped before compiling. The Command Line Tools folder has two module maps, and both define SwiftBridging, so Foundation cannot build.

Command Line Tools 16 uses bridging.modulemap. The extra file is the older module.modulemap, which Clang still loads because of its name. Move the older file aside, then run this script again:

sudo mv /Library/Developer/CommandLineTools/usr/include/swift/module.modulemap{,.bak}
EOF
    exit 1
  fi
}

# A real definition, not `extern module SwiftBridging "..."`.
# Bash pattern match, not grep -E, so the check does not depend on BSD grep.
swift_bridging_module_defined() {
  local file="$1" line trimmed
  [[ -f "$file" ]] || return 1
  while IFS= read -r line || [[ -n "$line" ]]; do
    trimmed="${line#"${line%%[![:space:]]*}"}"
    case "$trimmed" in
      "module SwiftBridging"|"module SwiftBridging "*|"module SwiftBridging{"*)
        return 0
        ;;
    esac
  done < "$file"
  return 1
}

stop_if_swift_bridging_is_defined_twice

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

# -Onone is the default so a 16 GB Mac finishes in about a minute.
# PREYAS_HELPER_OPT=-O opts into optimization.
OPT="${PREYAS_HELPER_OPT:--Onone}"

swiftc \
  -parse-as-library \
  -module-name PreyasHelper \
  -swift-version 6 \
  -Xfrontend -warn-long-expression-type-checking=200 \
  "$OPT" \
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
