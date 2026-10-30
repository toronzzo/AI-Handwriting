"""Print a compact starter context and a new session id."""

from __future__ import annotations

import sys

from agent_drive.history import create_session, recent_summaries
from agent_drive.mount import DriveNotReady, check_root
from agent_drive.paths import agent_root


def render_starter(root, session_id: str) -> str:
    summaries = recent_summaries(3, root)
    lines = [f"session: {session_id}", "", "## Recent summaries"]
    if summaries:
        for item in summaries:
            text = " ".join(item["summary"].split())
            lines.append(f"- {text}")
    else:
        lines.append("(none yet)")
    index = root / "skills" / "INDEX.md"
    lines.extend(["", "## Skills index"])
    if index.is_file():
        lines.append(index.read_text(encoding="utf-8").rstrip())
    else:
        lines.append("(no skills/INDEX.md yet)")
    lines.append("")
    return "\n".join(lines)


def main() -> int:
    root = agent_root()
    try:
        check_root(root)
        session_id = create_session(root)
        sys.stdout.write(render_starter(root, session_id))
    except DriveNotReady as exc:
        print(exc, file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
