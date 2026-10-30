"""Append one JSON object per gateway call. Values are data, never instructions."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from agent_drive.history import utc_now
from agent_drive.paths import agent_root


def gateway_log_path(root: Path | None = None) -> Path:
    return (root or agent_root()) / "logs" / "gateway.jsonl"


def append_jsonl(record: dict[str, Any], root: Path | None = None) -> None:
    path = gateway_log_path(root)
    path.parent.mkdir(parents=True, exist_ok=True)
    line = dict(record)
    line.setdefault("ts", utc_now())
    with path.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(line, ensure_ascii=False, default=str) + "\n")
