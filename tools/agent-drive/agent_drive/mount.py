"""Refuse to run when the workspace root is missing or not writable."""

from __future__ import annotations

import os
import subprocess
from pathlib import Path

from agent_drive.paths import allow_internal

_SYSTEM_VOLUMES = {
    "macintosh hd",
    "recovery",
    "preboot",
    "update",
    "vm",
}


class DriveNotReady(Exception):
    """The workspace cannot be used. The message is safe to show as-is."""


def volume_of(root: Path) -> Path | None:
    """Return ``/Volumes/<name>`` when ``root`` lives on a macOS volume."""
    parts = root.parts
    if len(parts) >= 3 and parts[0] == "/" and parts[1] == "Volumes":
        return Path("/", "Volumes", parts[2])
    return None


def _mount_table() -> str:
    chunks: list[str] = []
    try:
        chunks.append(subprocess.check_output(["mount"], text=True, stderr=subprocess.DEVNULL))
    except (OSError, subprocess.CalledProcessError):
        pass
    try:
        chunks.append(Path("/proc/mounts").read_text(encoding="utf-8"))
    except OSError:
        pass
    return "\n".join(chunks)


def is_mounted(volume: Path) -> bool:
    """True when ``volume`` is an actual mount, not a plain directory."""
    if not volume.is_dir():
        return False
    if os.path.ismount(volume):
        return True
    needle = f" on {volume} "
    table = _mount_table()
    if needle in table:
        return True
    target = str(volume)
    for line in table.splitlines():
        fields = line.split()
        if len(fields) >= 2 and fields[1] == target:
            return True
    return False


def _system_volume(name: str) -> bool:
    lowered = name.lower()
    if lowered.startswith("com.apple"):
        return True
    return lowered in _SYSTEM_VOLUMES or lowered.startswith("macintosh hd")


def check_root(root: Path) -> None:
    """Raise ``DriveNotReady`` with a clear message, and do not create anything.

    Paths under ``/Volumes/<drive>/...`` must be a mounted, non-system volume.
    Any other path is treated as the internal disk unless
    ``AGENT_DRIVE_ALLOW_INTERNAL=1`` (used by Linux CI).
    """
    volume = volume_of(root)
    if volume is not None:
        if _system_volume(volume.name):
            raise DriveNotReady(
                f"Refusing system volume '{volume.name}'. "
                "Point AGENT_DRIVE_ROOT at the external drive, for example /Volumes/Agent/agent."
            )
        if not is_mounted(volume):
            raise DriveNotReady(
                f"The external drive is not mounted: {volume}\n"
                "Plug in the drive, wait until it appears under /Volumes, then run this again.\n"
                "Nothing was written to the internal disk."
            )
    elif not allow_internal():
        raise DriveNotReady(
            f"Refusing to put the workspace on the internal disk: {root}\n"
            "Plug in the external drive and use /Volumes/<Drive>/agent "
            "(the default is /Volumes/Agent/agent).\n"
            "Nothing was written."
        )

    _ensure_writable(root)


def _ensure_writable(root: Path) -> None:
    if root.exists():
        if not root.is_dir():
            raise DriveNotReady(f"{root} exists and is not a directory. Nothing was changed.")
        probe = root / ".agent-drive-write-probe"
        try:
            probe.write_text("ok", encoding="utf-8")
            probe.unlink()
        except OSError as exc:
            reason = exc.strerror or "write failed"
            raise DriveNotReady(
                f"The agent drive is not writable: {root} ({reason}). Nothing else was changed."
            ) from None
        return

    parent = root.parent
    if not parent.is_dir() or not os.access(parent, os.W_OK):
        raise DriveNotReady(
            f"The agent drive is not writable: cannot create {root}. Nothing was written."
        )
