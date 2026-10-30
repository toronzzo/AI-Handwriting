"""Read ``secrets/.env`` without printing values."""

from __future__ import annotations

from pathlib import Path

_PLACEHOLDERS = {"changeme", "todo", "none", "null", "your-key", "sk-replace-me"}


def parse_env(text: str) -> dict[str, str]:
    values: dict[str, str] = {}
    for raw in text.splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("export "):
            line = line[len("export ") :].strip()
        if "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in {'"', "'"}:
            value = value[1:-1]
        if key:
            values[key] = value
    return values


def load_env_file(path: Path) -> dict[str, str]:
    if not path.is_file():
        return {}
    return parse_env(path.read_text(encoding="utf-8"))


def key_is_set(value: str | None) -> bool:
    if value is None:
        return False
    text = value.strip()
    if not text or text.startswith("#") or text.startswith("<") or "..." in text:
        return False
    return text.lower() not in _PLACEHOLDERS


def paid_key_present(env_file: Path) -> bool:
    """True only for a real DEEPSEEK_API_KEY. Other vendor keys do not enable fallback."""
    return key_is_set(load_env_file(env_file).get("DEEPSEEK_API_KEY"))


def deepseek_off_peak_only(root: Path) -> bool:
    value = load_env_file(root / "secrets" / ".env").get("DEEPSEEK_OFF_PEAK_ONLY", "")
    return value.strip().lower() in {"1", "true", "yes", "on"}
