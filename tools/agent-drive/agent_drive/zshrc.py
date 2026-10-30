"""Install one zshrc block that points caches at the drive when it is mounted."""

from __future__ import annotations

import re
from pathlib import Path

from agent_drive.paths import BEGIN_MARK, END_MARK

_BLOCK = re.compile(re.escape(BEGIN_MARK) + r".*?" + re.escape(END_MARK) + r"\n?", re.DOTALL)

_CACHE_VARS = (
    ("HF_HOME", "cache/huggingface"),
    ("PIP_CACHE_DIR", "cache/pip"),
    ("TORCH_HOME", "cache/torch"),
    ("XDG_CACHE_HOME", "cache/xdg"),
    ("UV_CACHE_DIR", "cache/uv"),
)


def zsh_quote(value: str) -> str:
    escaped = value.replace("\\", "\\\\").replace('"', '\\"').replace("$", "\\$").replace("`", "\\`")
    return f'"{escaped}"'


def render_block(root: Path) -> str:
    """Shell snippet. It exports cache dirs only when ``root`` is mounted and writable."""
    quoted = zsh_quote(str(root))
    lines = [
        BEGIN_MARK,
        "# Caches live on the external drive. This block does nothing when the drive is unplugged.",
        f"if [[ -d {quoted} && -w {quoted} ]]; then",
        f"  export AGENT_DRIVE_ROOT={quoted}",
    ]
    for name, rel in _CACHE_VARS:
        lines.append(f'  export {name}="$AGENT_DRIVE_ROOT/{rel}"')
    lines.append("fi")
    lines.append(END_MARK)
    return "\n".join(lines)


def install_block(path: Path, root: Path) -> None:
    """Insert the block once. Running again replaces it in place."""
    existing = path.read_text(encoding="utf-8") if path.is_file() else ""
    stripped = _BLOCK.sub("", existing).rstrip()
    block = render_block(root)
    if stripped:
        updated = stripped + "\n\n" + block + "\n"
    else:
        updated = block + "\n"
    if updated != existing:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(updated, encoding="utf-8")
