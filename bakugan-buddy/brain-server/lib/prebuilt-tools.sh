# Tools for this Mac without Homebrew.
#
# Homebrew here is not /opt/homebrew, and macOS 14 has no bottles.
# `brew install whisper-cpp` depends on llama.cpp, which build-depends on
# node, which build-depends on python@3.15. That compiles CPython with
# --with-tail-call-interp. Apple clang 16.2 then errors:
#   This compiler does not have support for efficient tail calling.
# Do not call `brew install` from these scripts.

find_existing_bin() {
  local name="$1"
  local candidate prefix
  if candidate="$(command -v "$name" 2>/dev/null)" && [[ -x "$candidate" ]]; then
    printf '%s\n' "$candidate"
    return 0
  fi
  for prefix in /opt/homebrew /usr/local "${HOME}/homebrew"; do
    candidate="$prefix/bin/$name"
    if [[ -x "$candidate" ]]; then
      printf '%s\n' "$candidate"
      return 0
    fi
  done
  if command -v brew >/dev/null 2>&1; then
    prefix="$(brew --prefix 2>/dev/null || true)"
    candidate="${prefix}/bin/$name"
    if [[ -n "$prefix" && -x "$candidate" ]]; then
      printf '%s\n' "$candidate"
      return 0
    fi
  fi
  return 1
}

require_llama_server() {
  if [[ -n "${LLAMA_BIN:-}" && -x "$LLAMA_BIN" ]]; then
    echo "have llama-server: $LLAMA_BIN"
    return 0
  fi
  local found
  found="$(find_existing_bin llama-server || true)"
  if [[ -n "$found" ]]; then
    LLAMA_BIN="$found"
    echo "have llama-server: $LLAMA_BIN"
    return 0
  fi
  echo "llama-server was not found." >&2
  echo "Looked on PATH and in /opt/homebrew/bin, /usr/local/bin, and ~/homebrew/bin." >&2
  echo "Do not run brew install llama.cpp on this Mac." >&2
  echo "That build compiles Python 3.15 and fails with: This compiler does not have support for efficient tail calling." >&2
  echo "The llama-server you already built is enough. Put it on PATH, or:" >&2
  echo "  LLAMA_BIN=/path/to/llama-server ./setup-all.sh" >&2
  exit 1
}

install_standalone_python() {
  PY311="$BAKUGAN_DATA_DIR/tools/python/bin/python3.11"
  if [[ -x "$PY311" ]]; then
    echo "have $PY311"
    return 0
  fi
  if [[ "$(uname -s)" != "Darwin" || "$(uname -m)" != "arm64" ]]; then
    echo "The prebuilt Python is for Apple Silicon macOS." >&2
    exit 1
  fi
  local url="https://github.com/astral-sh/python-build-standalone/releases/download/20261026/cpython-3.11.18+20261026-aarch64-apple-darwin-install_only.tar.gz"
  local tmp
  tmp="$(mktemp -d)"
  echo "GET $url"
  curl -L --fail --retry 3 -o "$tmp/python.tgz" "$url"
  tar -xzf "$tmp/python.tgz" -C "$tmp"
  mkdir -p "$BAKUGAN_DATA_DIR/tools"
  rm -rf "$BAKUGAN_DATA_DIR/tools/python"
  mv "$tmp/python" "$BAKUGAN_DATA_DIR/tools/python"
  rm -rf "$tmp"
  if [[ ! -x "$PY311" ]]; then
    echo "Python 3.11 did not land at $PY311" >&2
    exit 1
  fi
  echo "python: $("$PY311" -c 'import sys; print(".".join(map(str, sys.version_info[:3])))')"
}

install_ffmpeg_binary() {
  local dest="$BAKUGAN_DATA_DIR/tools/bin/ffmpeg"
  if [[ -x "$dest" ]]; then
    FFMPEG="$dest"
    echo "have $FFMPEG"
    return 0
  fi
  local existing
  existing="$(find_existing_bin ffmpeg || true)"
  if [[ -n "$existing" ]]; then
    FFMPEG="$existing"
    echo "have ffmpeg: $FFMPEG"
    return 0
  fi
  if [[ "$(uname -s)" != "Darwin" || "$(uname -m)" != "arm64" ]]; then
    echo "ffmpeg is missing, and the prebuilt binary is for Apple Silicon macOS." >&2
    exit 1
  fi
  local url="https://github.com/eugeneware/ffmpeg-static/releases/download/b6.1.1/ffmpeg-darwin-arm64.gz"
  mkdir -p "$BAKUGAN_DATA_DIR/tools/bin"
  echo "GET $url"
  curl -L --fail --retry 3 -o "$dest.gz" "$url"
  gzip -dc "$dest.gz" >"$dest"
  rm -f "$dest.gz"
  chmod +x "$dest"
  FFMPEG="$dest"
  echo "ffmpeg: $FFMPEG"
}

install_cmake_binary() {
  local cmake="$BAKUGAN_DATA_DIR/tools/cmake/CMake.app/Contents/bin/cmake"
  if [[ -x "$cmake" ]]; then
    CMAKE_BIN="$cmake"
    return 0
  fi
  local existing
  existing="$(find_existing_bin cmake || true)"
  if [[ -n "$existing" ]]; then
    CMAKE_BIN="$existing"
    return 0
  fi
  local url="https://github.com/Kitware/CMake/releases/download/v4.4.5/cmake-4.4.5-macos-universal.tar.gz"
  local tmp
  tmp="$(mktemp -d)"
  mkdir -p "$BAKUGAN_DATA_DIR/tools"
  echo "GET $url"
  curl -L --fail --retry 3 -o "$tmp/cmake.tgz" "$url"
  tar -xzf "$tmp/cmake.tgz" -C "$BAKUGAN_DATA_DIR/tools"
  rm -rf "$BAKUGAN_DATA_DIR/tools/cmake"
  mv "$BAKUGAN_DATA_DIR/tools/cmake-4.4.5-macos-universal" "$BAKUGAN_DATA_DIR/tools/cmake"
  rm -rf "$tmp"
  CMAKE_BIN="$cmake"
  if [[ ! -x "$CMAKE_BIN" ]]; then
    echo "cmake did not land at $CMAKE_BIN" >&2
    exit 1
  fi
}

copy_whisper_bin() {
  local build="$1" name="$2" dest="$3"
  local candidate
  for candidate in "$build/bin/$name" "$build/$name"; do
    if [[ -x "$candidate" ]]; then
      cp "$candidate" "$dest/$name"
      chmod +x "$dest/$name"
      return 0
    fi
  done
  return 1
}

install_whisper_cpp() {
  local dest="$BAKUGAN_DATA_DIR/tools/whisper"
  if [[ -x "$dest/whisper-cli" && -x "$dest/whisper-server" ]]; then
    WHISPER_BIN="$dest/whisper-cli"
    WHISPER_SERVER="$dest/whisper-server"
    echo "have whisper: $dest"
    return 0
  fi
  local cli server
  cli="$(find_existing_bin whisper-cli || find_existing_bin whisper-cpp || true)"
  server="$(find_existing_bin whisper-server || true)"
  if [[ -n "$cli" && -n "$server" ]]; then
    WHISPER_BIN="$cli"
    WHISPER_SERVER="$server"
    echo "have whisper-cli: $WHISPER_BIN"
    return 0
  fi
  if ! command -v git >/dev/null 2>&1; then
    echo "git is missing, so whisper.cpp cannot be built." >&2
    exit 1
  fi
  if ! command -v clang >/dev/null 2>&1; then
    echo "clang is missing. Install the Xcode Command Line Tools: xcode-select --install" >&2
    echo "Full Xcode is not required." >&2
    exit 1
  fi
  install_cmake_binary
  local src="$BAKUGAN_DATA_DIR/tools/src/whisper.cpp"
  if [[ ! -f "$src/CMakeLists.txt" ]]; then
    rm -rf "$src"
    mkdir -p "$BAKUGAN_DATA_DIR/tools/src"
    git clone --depth 1 --branch v1.9.5 https://github.com/ggml-org/whisper.cpp.git "$src"
  fi
  local jobs
  jobs="$(sysctl -n hw.ncpu 2>/dev/null || echo 4)"
  if [[ "$jobs" -gt 4 ]]; then
    jobs=4
  fi
  echo "Building whisper.cpp v1.9.5 with the Command Line Tools (no Homebrew, no full Xcode)."
  if ! whisper_cmake_build "$src" ON "$jobs"; then
    echo "Metal build failed. Building whisper.cpp for the CPU instead."
    whisper_cmake_build "$src" OFF "$jobs"
  fi
  mkdir -p "$dest"
  if [[ -d "$src/build/bin" ]]; then
    cp -R "$src/build/bin/." "$dest/"
  fi
  copy_whisper_bin "$src/build" whisper-cli "$dest" || true
  copy_whisper_bin "$src/build" whisper-server "$dest" || true
  WHISPER_BIN="$dest/whisper-cli"
  WHISPER_SERVER="$dest/whisper-server"
  if [[ ! -x "$WHISPER_BIN" || ! -x "$WHISPER_SERVER" ]]; then
    echo "whisper.cpp build did not produce whisper-cli and whisper-server." >&2
    exit 1
  fi
  echo "whisper: $WHISPER_BIN"
}

whisper_cmake_build() {
  local src="$1" metal="$2" jobs="$3"
  rm -rf "$src/build"
  "$CMAKE_BIN" -S "$src" -B "$src/build" \
    -DCMAKE_BUILD_TYPE=Release \
    -DBUILD_SHARED_LIBS=OFF \
    -DWHISPER_BUILD_TESTS=OFF \
    -DWHISPER_BUILD_EXAMPLES=ON \
    -DWHISPER_BUILD_SERVER=ON \
    -DWHISPER_USE_SYSTEM_GGML=OFF \
    -DWHISPER_USE_SYSTEM_LLAMA=OFF \
    -DWHISPER_SDL2=OFF \
    -DGGML_METAL="$metal"
  "$CMAKE_BIN" --build "$src/build" -j "$jobs" --target whisper-cli whisper-server
}
