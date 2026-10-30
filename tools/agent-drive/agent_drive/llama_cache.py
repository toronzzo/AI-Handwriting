"""llama.cpp prompt-cache flags and slot save/restore.

The slot HTTP API belongs to llama-server itself. bakugan-buddy's brain proxy
on port 8788 only forwards chat completions, so this talks to llama-server
on port 8790 unless ``LLAMA_SERVER_URL`` says otherwise.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import urllib.error
import urllib.request
from pathlib import Path

from agent_drive.mount import DriveNotReady, check_root
from agent_drive.paths import agent_root

_NAME = re.compile(r"[A-Za-z0-9][A-Za-z0-9._-]{0,80}")
DEFAULT_LLAMA_SERVER = "http://127.0.0.1:8790"


def slot_dir(root: Path) -> Path:
    return root / "cache" / "llama-slots"


def flags(root: Path) -> str:
    return f"--cache-prompt --cache-reuse 256 --slot-save-path {slot_dir(root)}"


def slot_filename(name: str) -> str:
    if not _NAME.fullmatch(name):
        raise ValueError("Slot name must be a simple filename (letters, numbers, ., _, -).")
    if name.endswith(".bin"):
        return name
    return name + ".bin"


def slot_request(action: str, slot: int, name: str) -> tuple[str, dict[str, str]]:
    if action not in {"save", "restore"}:
        raise ValueError("action must be save or restore")
    if slot < 0:
        raise ValueError("slot must be >= 0")
    filename = slot_filename(name)
    return f"/slots/{slot}?action={action}", {"filename": filename}


def llama_server_url() -> str:
    return os.environ.get("LLAMA_SERVER_URL", DEFAULT_LLAMA_SERVER).rstrip("/")


def call_slot(action: str, slot: int, name: str) -> dict:
    path, body = slot_request(action, slot, name)
    url = llama_server_url() + path
    request = urllib.request.Request(
        url,
        data=json.dumps(body).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            raw = response.read().decode("utf-8")
    except urllib.error.URLError as exc:
        raise RuntimeError(
            f"Could not reach llama-server at {url}: {exc.reason}. "
            "Start it with the flags from `./llama/cache.sh flags`. "
            "brain-server's chat proxy on 8788 does not expose /slots."
        ) from None
    if not raw.strip():
        return {"ok": True, "action": action, "filename": body["filename"]}
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError:
        return {"ok": True, "raw": raw}
    if isinstance(parsed, dict):
        return parsed
    return {"ok": True, "raw": parsed}


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="llama.cpp cache-reuse flags and slot save/restore.")
    sub = parser.add_subparsers(dest="cmd", required=True)
    sub.add_parser("flags", help="Print llama-server flags. Does not start the server.")
    for name in ("save", "restore"):
        command = sub.add_parser(name, help=f"{name} a prompt-cache slot")
        command.add_argument("--slot", type=int, default=0)
        command.add_argument("--name", default="slot")
    args = parser.parse_args(argv)
    root = agent_root()
    try:
        check_root(root)
    except DriveNotReady as exc:
        print(exc, file=sys.stderr)
        return 1
    if args.cmd == "flags":
        print(flags(root))
        print(f"slot directory: {slot_dir(root)}", file=sys.stderr)
        return 0
    slot_dir(root).mkdir(parents=True, exist_ok=True)
    try:
        payload = call_slot(args.cmd, args.slot, args.name)
    except (RuntimeError, ValueError) as exc:
        print(exc, file=sys.stderr)
        return 1
    print(json.dumps(payload, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
