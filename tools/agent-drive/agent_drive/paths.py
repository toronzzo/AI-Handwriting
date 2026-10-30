"""Resolve the workspace root. Data lives on the drive, code lives in the repo."""

from __future__ import annotations

import os
from pathlib import Path

DEFAULT_ROOT = Path("/Volumes/Agent/agent")
PACKAGE_ROOT = Path(__file__).resolve().parents[1]
TEMPLATES = PACKAGE_ROOT / "templates"

BEGIN_MARK = "# >>> agent-drive >>>"
END_MARK = "# <<< agent-drive <<<"


def agent_root() -> Path:
    """Folder that holds caches, history, skills, and secrets.

    ``AGENT_DRIVE_ROOT`` overrides the default ``/Volumes/Agent/agent``.
    Relative values are resolved from the current working directory.
    """
    raw = os.environ.get("AGENT_DRIVE_ROOT", "").strip()
    path = Path(raw).expanduser() if raw else DEFAULT_ROOT
    if not path.is_absolute():
        path = (Path.cwd() / path).resolve()
    return path


def zshrc_path() -> Path:
    raw = os.environ.get("AGENT_DRIVE_ZSHRC", "").strip()
    if raw:
        return Path(raw).expanduser()
    return Path.home() / ".zshrc"


def allow_internal() -> bool:
    return os.environ.get("AGENT_DRIVE_ALLOW_INTERNAL", "").strip() == "1"


def skip_venv() -> bool:
    return os.environ.get("AGENT_DRIVE_SKIP_VENV", "").strip() == "1"
