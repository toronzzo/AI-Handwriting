"""Local rules stay untracked. New sessions print summaries and the skills index."""

from __future__ import annotations

import os
import subprocess
from pathlib import Path

from agent_drive.history import add_summary, create_session, log_exchange
from agent_drive.rules import install_all, install_repo
from agent_drive.session import render_starter
from agent_drive.summarize import summarize_session
from tests.fake_openai import FakeOpenAI


def _git(repo: Path, *args: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(["git", *args], cwd=repo, capture_output=True, text=True, check=True)


def test_rules_are_excluded_from_git(tmp_path: Path, monkeypatch) -> None:
    root = tmp_path / "drive"
    repo = root / "repos" / "demo"
    repo.mkdir(parents=True)
    _git(repo, "init", "-q")
    _git(repo, "config", "user.email", "dev@example.com")
    _git(repo, "config", "user.name", "dev")
    (repo / "README.md").write_text("demo\n", encoding="utf-8")
    _git(repo, "add", "README.md")
    _git(repo, "commit", "-q", "-m", "init")

    monkeypatch.setenv("AGENT_DRIVE_ROOT", str(root))
    monkeypatch.setenv("AGENT_DRIVE_ALLOW_INTERNAL", "1")
    assert install_all(root) == 0
    install_repo(repo)

    assert (repo / "AGENTS.md").is_file()
    rule = repo / ".cursor" / "rules" / "agent-drive.mdc"
    assert rule.is_file()
    assert "alwaysApply: true" in rule.read_text(encoding="utf-8")
    assert "skills/INDEX.md" in (repo / "AGENTS.md").read_text(encoding="utf-8")
    status = _git(repo, "status", "--porcelain")
    assert status.stdout.strip() == ""
    exclude = (repo / ".git" / "info" / "exclude").read_text(encoding="utf-8")
    assert exclude.count("/AGENTS.md") == 1
    assert exclude.count("/.cursor/rules/agent-drive.mdc") == 1


def test_new_session_prints_last_three_summaries_and_index(tmp_path: Path) -> None:
    root = tmp_path / "drive"
    skills = root / "skills"
    skills.mkdir(parents=True)
    (skills / "INDEX.md").write_text("INDEX-MARKER use-the-local-gateway\n", encoding="utf-8")
    for label in ("oldest", "s2", "s3", "newest"):
        session_id = create_session(root, title=label)
        add_summary(session_id, f"summary-{label}", root)
    text = render_starter(root, "ses_new")
    assert "session: ses_new" in text
    assert "summary-newest" in text
    assert "summary-s3" in text
    assert "summary-s2" in text
    assert "summary-oldest" not in text
    assert "INDEX-MARKER" in text


def test_summarize_stores_the_local_reply(tmp_path: Path) -> None:
    root = tmp_path / "drive"
    root.mkdir()
    session_id = create_session(root)
    log_exchange(
        session_id=session_id,
        call_id="call-1",
        user_text="user: remember the drive",
        assistant_text="assistant: saved",
        model="local",
        cache_hit=False,
        prompt_tokens=3,
        completion_tokens=2,
        root=root,
    )
    fake = FakeOpenAI().start()
    try:
        summary = summarize_session(session_id, base_url=fake.base_url, model="local", root=root)
    finally:
        fake.close()
    assert summary == "reply-1"
    assert fake.hits == 1
    from agent_drive.history import recent_summaries

    stored = recent_summaries(1, root)
    assert stored[0]["summary"] == "reply-1"
    assert stored[0]["session_id"] == session_id


def test_shell_scripts_parse() -> None:
    package = Path(__file__).resolve().parents[1]
    for rel in (
        "setup.sh",
        "install-rules.sh",
        "gateway/start.sh",
        "llama/cache.sh",
        "bin/new_session.sh",
        "bin/summarize.sh",
        "bin/offpeak.sh",
    ):
        result = subprocess.run(["bash", "-n", str(package / rel)], capture_output=True, text=True, check=False)
        assert result.returncode == 0, result.stderr


def test_secrets_env_is_gitignored() -> None:
    repo = Path(__file__).resolve().parents[3]
    result = subprocess.run(
        ["git", "check-ignore", "-v", "tools/agent-drive/secrets/.env"],
        cwd=repo,
        capture_output=True,
        text=True,
        check=False,
    )
    assert result.returncode == 0
    assert "secrets/.env" in result.stdout


def test_llama_cache_script_prints_flags(tmp_path: Path) -> None:
    package = Path(__file__).resolve().parents[1]
    env = os.environ.copy()
    env["AGENT_DRIVE_ROOT"] = str(tmp_path)
    env["AGENT_DRIVE_ALLOW_INTERNAL"] = "1"
    result = subprocess.run(
        ["bash", "llama/cache.sh", "flags"],
        cwd=package,
        env=env,
        capture_output=True,
        text=True,
        check=False,
    )
    assert result.returncode == 0, result.stderr
    assert "--cache-reuse 256" in result.stdout
    assert str(tmp_path / "cache" / "llama-slots") in result.stdout
