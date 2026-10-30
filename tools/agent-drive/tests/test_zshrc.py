"""The zshrc block is written once and only exports caches when the drive is there."""

from __future__ import annotations

import os
import shutil
import subprocess
from pathlib import Path

import pytest

from agent_drive.paths import BEGIN_MARK, END_MARK
from agent_drive.zshrc import install_block, render_block

PACKAGE = Path(__file__).resolve().parents[1]
_VARS = ("HF_HOME", "PIP_CACHE_DIR", "TORCH_HOME", "XDG_CACHE_HOME", "UV_CACHE_DIR")


def test_install_block_is_idempotent(tmp_path: Path) -> None:
    zshrc = tmp_path / ".zshrc"
    zshrc.write_text("# user settings\nexport EDITOR=vim\n", encoding="utf-8")
    root = tmp_path / "agent"
    install_block(zshrc, root)
    install_block(zshrc, root)
    text = zshrc.read_text(encoding="utf-8")
    assert text.count(BEGIN_MARK) == 1
    assert text.count(END_MARK) == 1
    assert "export EDITOR=vim" in text
    for name in _VARS:
        assert f"export {name}=" in text
    assert "-d " in text and "-w " in text
    assert str(root) in text


def test_setup_sh_zshrc_is_idempotent(tmp_path: Path) -> None:
    root = tmp_path / "drive"
    zshrc = tmp_path / "zshrc"
    zshrc.write_text("# keep me\n", encoding="utf-8")
    env = os.environ.copy()
    env.update(
        {
            "AGENT_DRIVE_ROOT": str(root),
            "AGENT_DRIVE_ALLOW_INTERNAL": "1",
            "AGENT_DRIVE_SKIP_VENV": "1",
            "AGENT_DRIVE_ZSHRC": str(zshrc),
        }
    )
    for _ in range(2):
        result = subprocess.run(
            ["bash", "setup.sh"],
            cwd=PACKAGE,
            env=env,
            capture_output=True,
            text=True,
            check=False,
        )
        assert result.returncode == 0, result.stderr
    text = zshrc.read_text(encoding="utf-8")
    assert text.count(BEGIN_MARK) == 1
    assert "# keep me" in text
    assert (root / "skills" / "INDEX.md").is_file()
    assert (root / "notes" / "plans").is_dir()
    assert (root / "cache" / "litellm").is_dir()
    assert (root / "cache" / "llama-slots").is_dir()
    assert (root / "history").is_dir()
    assert (root / "logs").is_dir()
    assert (root / "secrets").is_dir()
    env_file = root / "secrets" / ".env"
    assert env_file.is_file()
    assert env_file.stat().st_mode & 0o777 == 0o600
    assert not (root / "venv").exists()
    assert "HF_HOME" in render_block(root)


def test_setup_does_not_echo_an_existing_key(tmp_path: Path) -> None:
    root = tmp_path / "drive"
    root.mkdir()
    secret = root / "secrets"
    secret.mkdir()
    key = "sk-test-do-not-print-3131"
    (secret / ".env").write_text(f"DEEPSEEK_API_KEY={key}\n", encoding="utf-8")
    zshrc = tmp_path / "zshrc"
    env = os.environ.copy()
    env.update(
        {
            "AGENT_DRIVE_ROOT": str(root),
            "AGENT_DRIVE_ALLOW_INTERNAL": "1",
            "AGENT_DRIVE_SKIP_VENV": "1",
            "AGENT_DRIVE_ZSHRC": str(zshrc),
        }
    )
    result = subprocess.run(
        ["bash", "setup.sh"],
        cwd=PACKAGE,
        env=env,
        capture_output=True,
        text=True,
        check=False,
    )
    assert result.returncode == 0, result.stderr
    assert key not in result.stdout
    assert key not in result.stderr
    assert (secret / ".env").read_text(encoding="utf-8") == f"DEEPSEEK_API_KEY={key}\n"


def test_block_exports_only_when_the_directory_is_writable(tmp_path: Path) -> None:
    zsh = shutil.which("zsh")
    if zsh is None:
        pytest.skip("zsh is not installed")
    root = tmp_path / "agent"
    zshrc = tmp_path / ".zshrc"
    install_block(zshrc, root)
    missing = subprocess.run(
        [zsh, "-c", f'source "{zshrc}"; printf %s "${{HF_HOME-}}"'],
        capture_output=True,
        text=True,
        check=False,
    )
    assert missing.returncode == 0, missing.stderr
    assert missing.stdout == ""
    root.mkdir()
    present = subprocess.run(
        [zsh, "-c", f'source "{zshrc}"; printf %s "$HF_HOME"'],
        capture_output=True,
        text=True,
        check=False,
    )
    assert present.returncode == 0, present.stderr
    assert present.stdout == str(root / "cache" / "huggingface")
