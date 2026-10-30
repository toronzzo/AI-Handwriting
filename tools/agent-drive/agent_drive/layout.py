"""Create the drive folders and starter files. Existing notes are left alone."""

from __future__ import annotations

import stat
from pathlib import Path

from agent_drive.paths import TEMPLATES

_DIRS = (
    "skills",
    "notes/plans",
    "cache/huggingface",
    "cache/pip",
    "cache/torch",
    "cache/xdg",
    "cache/uv",
    "cache/litellm",
    "cache/llama-slots",
    "history",
    "logs",
    "secrets",
    "repos",
    "prompts",
)


def create_dirs(root: Path) -> None:
    for rel in _DIRS:
        (root / rel).mkdir(parents=True, exist_ok=True)


def _write_if_missing(path: Path, text: str, mode: int | None = None) -> None:
    if path.exists():
        if mode is not None:
            path.chmod(mode)
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")
    if mode is not None:
        path.chmod(mode)


def seed_files(root: Path) -> None:
    create_dirs(root)
    _write_if_missing(root / "skills" / "INDEX.md", (TEMPLATES / "INDEX.md").read_text(encoding="utf-8"))
    skill = TEMPLATES / "use-the-local-gateway.md"
    _write_if_missing(root / "skills" / skill.name, skill.read_text(encoding="utf-8"))
    prefix = TEMPLATES / "deepseek-prefix.txt"
    _write_if_missing(root / "prompts" / prefix.name, prefix.read_text(encoding="utf-8"))
    _write_if_missing(
        root / "notes" / "README.md",
        "Plans live in plans/. Keep each plan short: goal, done-when, and only the steps that matter.\n",
    )
    _write_if_missing(
        root / "repos" / "README.md",
        "Clone git repos into this folder, then run install-rules.sh from the agent-drive toolkit.\n",
    )
    _write_if_missing(root / ".gitignore", (TEMPLATES / "drive.gitignore").read_text(encoding="utf-8"))
    example = (TEMPLATES / "secrets.env.example").read_text(encoding="utf-8")
    env_path = root / "secrets" / ".env"
    _write_if_missing(env_path, example, mode=stat.S_IRUSR | stat.S_IWUSR)
    env_path.chmod(stat.S_IRUSR | stat.S_IWUSR)
    (root / "secrets").chmod(stat.S_IRWXU)
