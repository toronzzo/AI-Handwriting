#!/usr/bin/env bash
# Point the next start.sh at another downloaded tier.
#   ./use-model.sh fast
#   ./use-model.sh default
#   ./use-model.sh default-q5
#   ./use-model.sh large
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=lib/ensure-drive.sh
source "$ROOT/lib/ensure-drive.sh"
ID="${1:-}"
if [[ -z "$ID" ]]; then
  echo "usage: ./use-model.sh fast|default|default-q5|large" >&2
  exit 1
fi
if [[ ! -f "$ROOT/brain.env" ]]; then
  echo "No brain.env. Run ./setup.sh first." >&2
  exit 1
fi
set -a
# shellcheck disable=SC1091
source "$ROOT/brain.env"
set +a
ensure_bakugan_drive
meta="$(node -e '
  const m = require(process.argv[1]);
  const t = m[process.argv[2]];
  if (!t) process.exit(2);
  process.stdout.write([t.file, t.warn ? "1" : "0", t.label].join("\t"));
' "$ROOT/models.json" "$ID")" || {
  echo "Unknown model id: $ID" >&2
  exit 1
}
IFS=$'\t' read -r file warn label <<<"$meta"
if [[ ! -f "$BAKUGAN_DATA_DIR/models/$file" ]]; then
  echo "Missing $file on the external drive." >&2
  echo "Download it with: ./setup.sh --model $ID" >&2
  exit 1
fi
if [[ "$warn" == "1" ]]; then
  echo "NOTE: $label is the slow 14B tier. ./start.sh will ask you to confirm."
fi
node -e '
  const fs = require("fs");
  const path = process.argv[1];
  const id = process.argv[2];
  const prev = JSON.parse(fs.readFileSync(path, "utf8"));
  prev.model = id;
  fs.writeFileSync(path, JSON.stringify(prev, null, 2) + "\n");
' "$BAKUGAN_DATA_DIR/brain.json" "$ID"
echo "Next start uses $ID ($label)."
echo "Restart ./start.sh to load it."
