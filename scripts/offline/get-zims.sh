#!/usr/bin/env bash
# Download Kiwix ZIM packs into the Agent drive.
#
# Defaults: the newest English astronomy Wikipedia (maxi, with pictures) and the
# newest English iFixit how-to pack. The 119 GB full English Wikipedia is opt-in
# only, because it will not fit beside everything else on a normal drive.
#
#   scripts/offline/get-zims.sh
#   PREYAS_DOWNLOAD_FULL_WIKIPEDIA=1 scripts/offline/get-zims.sh
#   PREYAS_ZIM_ONLY=astronomy scripts/offline/get-zims.sh
#
# Nothing here runs in CI and no ZIM file is ever committed.
set -euo pipefail

OUT_DIR="${PREYAS_ZIM_DIR:-/Volumes/Agent/agent/knowledge/zim}"
DOWNLOAD_BASE="${KIWIX_DOWNLOAD_BASE:-https://download.kiwix.org/zim}"
# Which packs to fetch: "default" (astronomy + iFixit) or a comma list of
# astronomy, ifixit and wikipedia (the full pack).
ONLY="${PREYAS_ZIM_ONLY:-default}"

mkdir -p "$OUT_DIR"

# "default" means astronomy and iFixit; anything else is a comma list of
# pack names, where "wikipedia" means the opt-in full pack.
wanted() {
  local pack="$1"
  case "$ONLY" in
    default|"")
      [[ "$pack" == "astronomy" || "$pack" == "ifixit" ]] && return 0
      [[ "$pack" == "wikipedia" && "${PREYAS_DOWNLOAD_FULL_WIKIPEDIA:-0}" == "1" ]] && return 0
      return 1
      ;;
  esac
  case ",$ONLY," in
    *",$pack,"*) return 0 ;;
    *",full,"*|*",wikipedia,"*)
      [[ "$pack" == "wikipedia" && "${PREYAS_DOWNLOAD_FULL_WIKIPEDIA:-0}" == "1" ]] && return 0 ;;
  esac
  return 1
}

# The newest published file in a Kiwix folder matching an exact prefix, so
# "wikipedia_en_astronomy_maxi_2026-08.zim" wins over the 2026-05 one without
# anyone editing this script.
newest_zim() {
  local folder="$1" prefix="$2"
  curl -fsSL --max-time 60 --retry 3 "$DOWNLOAD_BASE/$folder/" \
    | grep -o "href=\"[^\"]*\"" \
    | sed 's/^href="//;s/"$//' \
    | sed 's|.*/||' \
    | grep -E "^${prefix}[0-9]{4}-[0-9]{2}\.zim$" \
    | sort -V \
    | tail -n 1
}

sha256_of() {
  if command -v shasum >/dev/null 2>&1; then shasum -a 256 "$1" | awk '{print $1}'; else sha256sum "$1" | awk '{print $1}'; fi
}

# Download with resume. A partial file is kept so an interrupted run continues;
# after the transfer the published .sha256 sidecar decides whether it is sound.
download_zim() {
  local url="$1" name out expected actual
  name="${url##*/}"
  out="$OUT_DIR/$name"

  if [[ -f "$out.sha256" && -f "$out" ]]; then
    actual="$(sha256_of "$out")"
    expected="$(awk 'NR==1 {print $1}' "$out.sha256")"
    if [[ -n "$expected" && "$actual" == "$expected" ]]; then
      echo "Already verified: $name"
      return 0
    fi
  fi

  echo "Downloading $name (resumable)"
  if ! curl -fL --retry 3 --retry-delay 2 --continue-at - "$url" -o "$out"; then
    echo "Download failed for $name; a later run resumes from the partial file" >&2
    return 1
  fi

  if curl -fsSL --max-time 60 "$url.sha256" -o "$out.sha256"; then
    expected="$(awk 'NR==1 {print $1}' "$out.sha256")"
    actual="$(sha256_of "$out")"
    if [[ -n "$expected" && "$actual" != "$expected" ]]; then
      echo "Checksum mismatch for $name; deleting the bad copy so a retry starts clean" >&2
      rm -f "$out" "$out.sha256"
      return 1
    fi
    echo "Checksum OK: $name"
  else
    rm -f "$out.sha256"
    echo "No published checksum for $name; kept the download unverified" >&2
  fi
  echo "Ready: $out"
}

# Which pack names this run will fetch, one per line: folder, then prefix.
# Printed instead of downloaded when --list is passed, and used by the tests.
plan_packs() {
  if wanted astronomy; then printf 'wikipedia %s\n' "wikipedia_en_astronomy_maxi_"; fi
  if wanted ifixit; then printf 'ifixit %s\n' "ifixit_en_all_"; fi
  if wanted wikipedia && [[ "${PREYAS_DOWNLOAD_FULL_WIKIPEDIA:-0}" == "1" ]]; then
    printf 'wikipedia %s\n' "wikipedia_en_all_maxi_"
  fi
}

# Sourced by tests to reuse the helpers without running a download.
if [[ "${BASH_SOURCE[0]}" != "$0" ]]; then
  return 0
fi

if [[ "${1:-}" == "--list" ]]; then
  plan_packs
  exit 0
fi

status=0

while read -r folder prefix; do
  [[ -n "${prefix:-}" ]] || continue
  name="$(newest_zim "$folder" "$prefix")" || true
  if [[ -n "${name:-}" ]]; then
    download_zim "$DOWNLOAD_BASE/$folder/$name" || status=1
  else
    echo "No published pack matched ${prefix}* in $DOWNLOAD_BASE/$folder/" >&2
    status=1
  fi
done < <(plan_packs)

if [[ "${PREYAS_DOWNLOAD_FULL_WIKIPEDIA:-0}" != "1" ]]; then
  echo "Full Wikipedia (~119 GB) is opt-in: set PREYAS_DOWNLOAD_FULL_WIKIPEDIA=1"
fi

exit "$status"
