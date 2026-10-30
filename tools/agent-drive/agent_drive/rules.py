"""Drop AGENTS.md and the Cursor rule into repos as untracked local files."""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

from agent_drive.mount import DriveNotReady, check_root
from agent_drive.paths import TEMPLATES, agent_root

_EXCLUDE_HEADER = "# agent-drive local rules (kept out of git)"
_EXCLUDE_PATHS = ("/AGENTS.md", "/.cursor/rules/agent-drive.mdc")


def _tracked(repo: Path, rel: str) -> bool:
    result = subprocess.run(
        ["git", "ls-files", "--error-unmatch", "--", rel],
        cwd=repo,
        capture_output=True,
        text=True,
        check=False,
    )
    return result.returncode == 0


def _ensure_exclude(repo: Path) -> None:
    exclude = repo / ".git" / "info" / "exclude"
    exclude.parent.mkdir(parents=True, exist_ok=True)
    existing = exclude.read_text(encoding="utf-8") if exclude.is_file() else ""
    lines = existing.splitlines()
    changed = False
    if _EXCLUDE_HEADER not in lines:
        if lines and lines[-1].strip():
            lines.append("")
        lines.append(_EXCLUDE_HEADER)
        changed = True
    for path in _EXCLUDE_PATHS:
        if path not in lines:
            lines.append(path)
            changed = True
    if changed:
        text = "\n".join(lines).rstrip() + "\n"
        exclude.write_text(text, encoding="utf-8")


def install_repo(repo: Path) -> None:
    """Copy the templates into one git repo and exclude them from commits."""
    if not (repo / ".git").is_dir():
        print(f"skip {repo}: not a git repo", file=sys.stderr)
        return
    _ensure_exclude(repo)
    agents = repo / "AGENTS.md"
    if _tracked(repo, "AGENTS.md"):
        print(f"{repo}: AGENTS.md is already tracked; left it alone.")
    else:
        agents.write_text((TEMPLATES / "AGENTS.md").read_text(encoding="utf-8"), encoding="utf-8")
    rule_rel = ".cursor/rules/agent-drive.mdc"
    rule = repo / rule_rel
    if _tracked(repo, rule_rel):
        print(f"{repo}: {rule_rel} is already tracked; left it alone.")
    else:
        rule.parent.mkdir(parents=True, exist_ok=True)
        rule.write_text((TEMPLATES / "agent-drive.mdc").read_text(encoding="utf-8"), encoding="utf-8")
    print(f"installed local rules in {repo}")


def install_all(root: Path | None = None) -> int:
    root = root or agent_root()
    check_root(root)
    repos = root / "repos"
    if not repos.is_dir():
        print(f"No repos directory at {repos}. Run setup.sh first.", file=sys.stderr)
        return 1
    found = [path for path in sorted(repos.iterdir()) if path.is_dir() and path.name != "README.md"]
    git_repos = [path for path in found if (path / ".git").is_dir()]
    if not git_repos:
        print(f"No git repos under {repos} yet. Clone one there, then run this again.")
        return 0
    for repo in git_repos:
        install_repo(repo)
    return 0


def main() -> int:
    try:
        return install_all()
    except DriveNotReady as exc:
        print(exc, file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
