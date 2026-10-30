"""The setup script stops, with a clear message, when the drive is absent."""

from __future__ import annotations

import os
import stat
import subprocess
from pathlib import Path

import pytest

from agent_drive.mount import DriveNotReady, check_root

PACKAGE = Path(__file__).resolve().parents[1]


def _run_setup(env: dict[str, str]) -> subprocess.CompletedProcess[str]:
    merged = os.environ.copy()
    merged.pop("AGENT_DRIVE_ALLOW_INTERNAL", None)
    merged.update(env)
    return subprocess.run(
        ["bash", "setup.sh"],
        cwd=PACKAGE,
        env=merged,
        capture_output=True,
        text=True,
        check=False,
    )


def test_unmounted_volume_fails_safely() -> None:
    root = Path("/Volumes/NoSuchDriveAgent3131/agent")
    with pytest.raises(DriveNotReady) as caught:
        check_root(root)
    message = str(caught.value)
    assert "not mounted" in message
    assert "Nothing was written" in message
    assert not root.exists()
    assert not root.parent.exists()

    result = _run_setup(
        {
            "AGENT_DRIVE_ROOT": str(root),
            "AGENT_DRIVE_SKIP_VENV": "1",
        }
    )
    assert result.returncode != 0
    assert "not mounted" in result.stderr
    assert "Traceback" not in result.stderr
    assert "Traceback" not in result.stdout
    assert not root.exists()


def test_unwritable_root_fails_safely(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    root = tmp_path / "locked"
    root.mkdir()
    root.chmod(0o555)
    monkeypatch.setenv("AGENT_DRIVE_ALLOW_INTERNAL", "1")
    try:
        with pytest.raises(DriveNotReady) as caught:
            check_root(root)
        assert "not writable" in str(caught.value)

        zshrc = tmp_path / "zshrc"
        result = _run_setup(
            {
                "AGENT_DRIVE_ROOT": str(root),
                "AGENT_DRIVE_ALLOW_INTERNAL": "1",
                "AGENT_DRIVE_SKIP_VENV": "1",
                "AGENT_DRIVE_ZSHRC": str(zshrc),
            }
        )
        assert result.returncode != 0
        assert "not writable" in result.stderr
        assert "Traceback" not in result.stderr
        assert not zshrc.exists()
        assert not (root / "venv").exists()
    finally:
        root.chmod(stat.S_IRWXU)


def test_internal_disk_is_refused_without_override(tmp_path: Path) -> None:
    with pytest.raises(DriveNotReady) as caught:
        check_root(tmp_path / "agent")
    assert "internal disk" in str(caught.value)
    assert not (tmp_path / "agent").exists()
