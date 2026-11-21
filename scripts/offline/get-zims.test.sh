#!/usr/bin/env bash
# Tests for the ZIM pack planner. No network, no downloads, no kiwix-tools.
#
#   bash scripts/offline/get-zims.test.sh
set -uo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
script="$here/get-zims.sh"
fails=0

check() {
  local name="$1" expected="$2" actual="$3"
  if [[ "$expected" == "$actual" ]]; then
    echo "ok   $name"
  else
    echo "FAIL $name" >&2
    echo "     expected: $expected" >&2
    echo "     actual:   $actual" >&2
    fails=$((fails + 1))
  fi
}

plan() {
  env -u PREYAS_DOWNLOAD_FULL_WIKIPEDIA -u PREYAS_ZIM_ONLY "$@" "$script" --list | tr '\n' '|'
}

check "default fetch includes astronomy and iFixit, never full Wikipedia" \
  "wikipedia wikipedia_en_astronomy_maxi_|ifixit ifixit_en_all_|" \
  "$(plan env)"

check "full Wikipedia stays off until opted in" \
  "wikipedia wikipedia_en_astronomy_maxi_|ifixit ifixit_en_all_|wikipedia wikipedia_en_all_maxi_|" \
  "$(plan env PREYAS_DOWNLOAD_FULL_WIKIPEDIA=1)"

check "a flag other than 1 does not opt in" \
  "wikipedia wikipedia_en_astronomy_maxi_|ifixit ifixit_en_all_|" \
  "$(plan env PREYAS_DOWNLOAD_FULL_WIKIPEDIA=0)"

check "PREYAS_ZIM_ONLY narrows to one pack" \
  "wikipedia wikipedia_en_astronomy_maxi_|" \
  "$(plan env PREYAS_ZIM_ONLY=astronomy)"

check "PREYAS_ZIM_ONLY can fetch several packs" \
  "ifixit ifixit_en_all_|" \
  "$(plan env PREYAS_ZIM_ONLY=ifixit)"

# The filename chooser must pick the newest published pack, not the first line
# of the folder listing.
picker="$(cd "$here" && sed -n '/^newest_zim()/,/^}/p' get-zims.sh)"
check "newest_zim picks the newest astronomy pack" \
  "wikipedia_en_astronomy_maxi_2026-08.zim" \
  "$(DOWNLOAD_BASE=https://example.invalid \
     bash -c "set -euo pipefail
$picker
curl() { printf '%s\\n' \\
  'href=\"wikipedia_en_astronomy_maxi_2025-09.zim\"' \\
  'href=\"wikipedia_en_astronomy_maxi_2026-08.zim\"' \\
  'href=\"wikipedia_en_astronomy_maxi_2026-01.zim\"' \\
  'href=\"wikipedia_en_all_maxi_2026-08.zim\"' \\
  'href=\"..\"'; }
newest_zim wikipedia wikipedia_en_astronomy_maxi_")"

check "newest_zim ignores non-ZIM links and other prefixes" \
  "ifixit_en_all_2025-12.zim" \
  "$(DOWNLOAD_BASE=https://example.invalid \
     bash -c "set -euo pipefail
$picker
curl() { printf '%s\\n' \\
  'href=\"ifixit_de_all_2026-03.zim\"' \\
  'href=\"ifixit_en_all_2025-12.zim\"' \\
  'href=\"ifixit_en_all_2025-12.zim.sha256\"' \\
  'href=\"ifixit_en_all_2025-06.zim\"'; }
newest_zim ifixit ifixit_en_all_")"

check "no published match prints nothing" \
  "" \
  "$(DOWNLOAD_BASE=https://example.invalid \
     bash -c "set -euo pipefail
$picker
curl() { printf '%s\\n' 'href=\"..\"'; }
newest_zim wikipedia wikipedia_en_all_maxi_")"

# No wikiHow pack may be planned.
check "wikiHow is never part of the plan" \
  "" \
  "$(plan env PREYAS_ZIM_ONLY=howto,howtostepbystep,wikihow PREYAS_DOWNLOAD_FULL_WIKIPEDIA=1 | grep -o 'howto\|wikihow' | head -n1)"

if (( fails > 0 )); then
  echo "$fails failing" >&2
  exit 1
fi
echo "all pack-planner tests passed"
