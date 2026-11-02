"""One-time (and safe-to-repeat) workspace setup."""

from __future__ import annotations

import os
import platform
import shutil
import subprocess
import sys
import tarfile
import tempfile
import urllib.request
from pathlib import Path

from agent_drive.layout import seed_files
from agent_drive.mount import DriveNotReady, check_root
from agent_drive.paths import PACKAGE_ROOT, agent_root, skip_venv, zshrc_path
from agent_drive.zshrc import install_block


def python_too_old(version: tuple[int, ...]) -> bool:
    """litellm 1.106.6 refuses to install on the Mac's system Python 3.9."""
    return (version[0], version[1]) < (3, 10)


def uv_release_name(system: str | None = None, machine: str | None = None) -> str:
    system = (system if system is not None else platform.system()).lower()
    machine = (machine if machine is not None else platform.machine()).lower()
    if system == "darwin" and machine in {"arm64", "aarch64"}:
        return "uv-aarch64-apple-darwin.tar.gz"
    if system == "darwin":
        return "uv-x86_64-apple-darwin.tar.gz"
    if machine in {"arm64", "aarch64"}:
        return "uv-aarch64-unknown-linux-gnu.tar.gz"
    return "uv-x86_64-unknown-linux-gnu.tar.gz"


def ensure_uv(root: Path) -> Path:
    found = shutil.which("uv")
    if found:
        return Path(found)
    dest = root / "tools" / "uv" / "uv"
    if dest.is_file():
        return dest
    dest.parent.mkdir(parents=True, exist_ok=True)
    url = f"https://github.com/astral-sh/uv/releases/latest/download/{uv_release_name()}"
    with tempfile.TemporaryDirectory() as tmp:
        archive = Path(tmp) / "uv.tar.gz"
        urllib.request.urlretrieve(url, archive)
        with tarfile.open(archive) as tar:
            if sys.version_info >= (3, 12):
                tar.extractall(tmp, filter="data")
            else:
                tar.extractall(tmp)
        binary = next(path for path in Path(tmp).rglob("uv") if path.is_file() and path.name == "uv")
        shutil.copy2(binary, dest)
    dest.chmod(0o755)
    return dest


def ensure_drive_python(root: Path) -> str:
    """Python used to build the gateway venv. 3.9 downloads 3.12 onto the drive."""
    if not python_too_old(sys.version_info):
        return sys.executable
    uv = ensure_uv(root)
    install_dir = root / "tools" / "python"
    install_dir.mkdir(parents=True, exist_ok=True)
    env = os.environ.copy()
    env["UV_PYTHON_INSTALL_DIR"] = str(install_dir)
    subprocess.check_call([str(uv), "python", "install", "3.12"], env=env)
    found = subprocess.check_output([str(uv), "python", "find", "3.12"], env=env, text=True).strip()
    if not found:
        raise RuntimeError(f"uv did not install Python 3.12 under {install_dir}")
    return found


def venv_is_usable(python: Path) -> bool:
    if not python.is_file():
        return False
    out = subprocess.check_output(
        [str(python), "-c", "import sys; print(sys.version_info[0], sys.version_info[1])"],
        text=True,
    ).split()
    return not python_too_old((int(out[0]), int(out[1])))


def create_venv(root: Path) -> None:
    py = ensure_drive_python(root)
    venv_python = root / "venv" / "bin" / "python"
    if venv_python.is_file() and not venv_is_usable(venv_python):
        shutil.rmtree(root / "venv")
    if not venv_python.is_file():
        subprocess.check_call([py, "-m", "venv", str(root / "venv")])
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
