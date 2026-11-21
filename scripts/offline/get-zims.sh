#!/usr/bin/env bash
set -euo pipefail

OUT_DIR="${PREYAS_ZIM_DIR:-/Volumes/Agent/agent/knowledge/zim}"
DOWNLOAD_BASE="${KIWIX_DOWNLOAD_BASE:-https://download.kiwix.org/zim}"
mkdir -p "$OUT_DIR"

list_latest() {
  local url="$1"
  curl -L --fail --silent "$url/" \
    | grep -o 'href="[^"]*\.zim"' \
    | sed 's/^href="//;s/"$//' \
    | sort -Vu \
    | tail -n 1
}

download_zim() {
  local url="$1"
  local name="${url##*/}"
  local out="$OUT_DIR/$name"
  echo "Downloading $name"
  curl -L --fail --retry 3 --continue-at - "$url" -o "$out"

  local sha_url="${url}.sha256"
  if curl -L --fail --silent --show-error "$sha_url" -o "$out.sha256.tmp"; then
    local expected
    expected="$(awk 'NR==1 {print $1}' "$out.sha256.tmp")"
    rm -f "$out.sha256.tmp"
    if [[ -n "$expected" ]]; then
      local actual
      actual="$(shasum -a 256 "$out" | awk '{print $1}')"
      if [[ "$actual" != "$expected" ]]; then
        echo "Checksum mismatch for $name" >&2
        exit 1
      fi
    fi
  fi
  echo "Ready: $out"
}

astronomy="$(curl -L --fail --silent "$DOWNLOAD_BASE/wikipedia/" \
  | grep -o 'wikipedia_en_astronomy_maxi_[^\"<>]*\.zim' \
  | sort -Vu | tail -n 1)"
if [[ -n "$astronomy" ]]; then
  download_zim "$DOWNLOAD_BASE/wikipedia/$astronomy"
fi

ifixit="$(curl -L --fail --silent "$DOWNLOAD_BASE/ifixit/" \
  | grep -o 'ifixit_en_all_[^\"<>]*\.zim' \
  | sort -Vu | tail -n 1)"
if [[ -n "$ifixit" ]]; then
  download_zim "$DOWNLOAD_BASE/ifixit/$ifixit"
fi

if [[ "${PREYAS_DOWNLOAD_FULL_WIKIPEDIA:-0}" == "1" ]]; then
  full="$(curl -L --fail --silent "$DOWNLOAD_BASE/wikipedia/" \
    | grep -o 'wikipedia_en_all_maxi_[^\"<>]*\.zim' \
    | sort -Vu | tail -n 1)"
  if [[ -n "$full" ]]; then
    download_zim "$DOWNLOAD_BASE/wikipedia/$full"
  fi
else
  echo "Full Wikipedia is opt-in: set PREYAS_DOWNLOAD_FULL_WIKIPEDIA=1"
fi
