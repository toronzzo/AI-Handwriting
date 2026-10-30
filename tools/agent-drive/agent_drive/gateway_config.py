"""Render the LiteLLM proxy config. Secrets stay in the environment, not the file."""

from __future__ import annotations

import os
import sys
from pathlib import Path

from agent_drive.deepseek import DEEPSEEK_API_BASE, FLASH_MODEL, PRO_MODEL
from agent_drive.mount import DriveNotReady, check_root
from agent_drive.paths import agent_root
from agent_drive.secrets import key_is_set, load_env_file

DEFAULT_LOCAL_API_BASE = "http://127.0.0.1:8788/v1"


def local_api_base() -> str:
    return os.environ.get("AGENT_DRIVE_LOCAL_API_BASE", DEFAULT_LOCAL_API_BASE).strip() or DEFAULT_LOCAL_API_BASE


def _yaml_string(value: str) -> str:
    escaped = value.replace("\\", "\\\\").replace('"', '\\"')
    return f'"{escaped}"'


def _deepseek_entry(name: str, upstream: str) -> list[str]:
    return [
        f"  - model_name: {name}",
        "    litellm_params:",
        f"      model: {_yaml_string(f'openai/{upstream}')}",
        f"      api_base: {_yaml_string(DEEPSEEK_API_BASE)}",
        "      api_key: os.environ/DEEPSEEK_API_KEY",
    ]


def render_config(root: Path, *, include_paid: bool, local_base: str) -> str:
    """Exact-match disk cache on the drive. DeepSeek is omitted without a key.

    ``local`` is the only automatic route. ``paid`` is an alias of
    ``deepseek-flash`` and is used only as the fallback. ``deepseek-v4-pro``
    is listed for an explicit request; it is not a fallback.
    """
    cache_dir = root / "cache" / "litellm"
    lines = [
        "model_list:",
        "  - model_name: local",
        "    litellm_params:",
        "      model: openai/local",
        f"      api_base: {_yaml_string(local_base)}",
        '      api_key: "local"',
    ]
    if include_paid:
        lines.extend(_deepseek_entry("paid", FLASH_MODEL))
        lines.extend(_deepseek_entry(FLASH_MODEL, FLASH_MODEL))
        lines.extend(_deepseek_entry(PRO_MODEL, PRO_MODEL))
    lines.extend(
        [
            "",
            "litellm_settings:",
            "  drop_params: true",
            "  num_retries: 0",
            "  json_logs: true",
            "  cache: true",
            "  cache_params:",
            "    type: disk",
            f"    disk_cache_dir: {_yaml_string(str(cache_dir))}",
            "  callbacks:",
            "    - agent_drive.callback.proxy_handler_instance",
            "",
            "general_settings:",
            "  disable_spend_logs: true",
            "  store_model_in_db: false",
            "  # Loopback only (gateway/start.sh binds 127.0.0.1). No master key to paste around.",
            "  dangerously_permit_weak_or_unset_master_key: true",
        ]
    )
    if include_paid:
        lines.extend(
            [
                "",
                "router_settings:",
                "  fallbacks:",
                "    - local:",
                "        - paid",
            ]
        )
    lines.append("")
    return "\n".join(lines)


def config_path(root: Path | None = None) -> Path:
    return (root or agent_root()) / "cache" / "litellm" / "config.yaml"


def write_config(root: Path | None = None) -> Path:
    root = root or agent_root()
    check_root(root)
    env = load_env_file(root / "secrets" / ".env")
    include_paid = key_is_set(env.get("DEEPSEEK_API_KEY"))
    text = render_config(
        root,
        include_paid=include_paid,
        local_base=local_api_base(),
    )
    path = config_path(root)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")
    path.chmod(0o600)
    return path


def main() -> int:
    try:
        path = write_config()
    except DriveNotReady as exc:
        print(exc, file=sys.stderr)
        return 1
    print(path)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
