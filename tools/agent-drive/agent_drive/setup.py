"""One-time (and safe-to-repeat) workspace setup."""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

from agent_drive.layout import seed_files
from agent_drive.mount import DriveNotReady, check_root
from agent_drive.paths import PACKAGE_ROOT, agent_root, skip_venv, zshrc_path
from agent_drive.zshrc import install_block


def create_venv(root: Path) -> None:
    venv_python = root / "venv" / "bin" / "python"
    if not venv_python.is_file():
        subprocess.check_call([sys.executable, "-m", "venv", str(root / "venv")])
    pip = root / "venv" / "bin" / "pip"
    subprocess.check_call([str(pip), "install", "-U", "pip"])
    subprocess.check_call(
        [
            str(pip),
            "install",
            "-r",
            str(PACKAGE_ROOT / "requirements.txt"),
            "-e",
            str(PACKAGE_ROOT),
        ]
    )


def run() -> None:
    root = agent_root()
    check_root(root)
    root.mkdir(parents=True, exist_ok=True)
    seed_files(root)
    install_block(zshrc_path(), root)
    if not skip_venv():
        create_venv(root)
    print(f"agent-drive ready at {root}")
    print(f"zshrc block: {zshrc_path()}")
    if skip_venv():
        print("Skipped venv install (AGENT_DRIVE_SKIP_VENV=1).")
    else:
        print(f"venv: {root / 'venv'}")
    print("Open a new terminal so the cache variables load when the drive is mounted.")


def main() -> int:
    try:
        run()
    except DriveNotReady as exc:
        print(exc, file=sys.stderr)
        return 1
    except subprocess.CalledProcessError as exc:
        print(f"Setup command failed (exit {exc.returncode}).", file=sys.stderr)
        return exc.returncode or 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
