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
AUTO_ALIAS = "auto"
AUTO_TIMEOUT_S = 60
KIMI_API_BASE = "https://api.moonshot.ai/v1"
KIMI_MODEL = "kimi-k3"


def local_api_base() -> str:
    return os.environ.get("AGENT_DRIVE_LOCAL_API_BASE", DEFAULT_LOCAL_API_BASE).strip() or DEFAULT_LOCAL_API_BASE


def _yaml_string(value: str) -> str:
    escaped = value.replace("\\", "\\\\").replace('"', '\\"')
    return f'"{escaped}"'


def _cost_per_token(upstream: str) -> tuple[str, str]:
    """Off-peak cache-miss USD per token.

    Source: https://api-docs.deepseek.com/quick_start/pricing/ checked 2026-10-29.
    Flash is $0.15 / 1M input and $0.60 / 1M output. Pro is $0.66 and $1.98.
    LiteLLM warns and hides per-message cost when model_info has no prices.
    """
    if upstream == PRO_MODEL:
        return ("0.00000066", "0.00000198")
    return ("0.00000015", "0.0000006")


def _deepseek_entry(name: str, upstream: str) -> list[str]:
    input_cost, output_cost = _cost_per_token(upstream)
    return [
        f"  - model_name: {name}",
        "    litellm_params:",
        f"      model: {_yaml_string(f'openai/{upstream}')}",
        f"      api_base: {_yaml_string(DEEPSEEK_API_BASE)}",
        "      api_key: os.environ/DEEPSEEK_API_KEY",
        # DeepSeek can fill max_tokens with reasoning and leave content empty.
        "      extra_body:",
        "        thinking:",
        '          type: "disabled"',
        "    model_info:",
        f"      input_cost_per_token: {input_cost}",
        f"      output_cost_per_token: {output_cost}",
    ]


def _kimi_entry(name: str, effort: str) -> list[str]:
    """Kimi K3 for explicit, approved expert jobs only. Never a fallback.

    Source: https://platform.kimi.ai/docs/pricing/chat checked 2026-11-02.
    $3 / 1M input (cache miss, $0.30 cached) and $15 / 1M output.
    K3 always reasons; reasoning_effort is low, high or max (default max).
    """
    return [
        f"  - model_name: {name}",
        "    litellm_params:",
        f"      model: {_yaml_string(f'openai/{KIMI_MODEL}')}",
        f"      api_base: {_yaml_string(KIMI_API_BASE)}",
        "      api_key: os.environ/KIMI_API_KEY",
        "      extra_body:",
        f"        reasoning_effort: {_yaml_string(effort)}",
        "    model_info:",
        "      input_cost_per_token: 0.000003",
        "      output_cost_per_token: 0.000015",
        "      cache_read_input_token_cost: 0.0000003",
    ]


def _local_entry(name: str, local_base: str, *, timeout: int | None = None) -> list[str]:
    """A route served by llama-server, with thinking turned off at the template.

    llama.cpp leaves the Qwen3 reasoning block in ``content`` unless the chat
    template gets ``enable_thinking: false``; the callback also strips any
    leftover block for clients that ignore the flag.
    """
    lines = [
        f"  - model_name: {name}",
        "    litellm_params:",
        "      model: openai/local",
        f"      api_base: {_yaml_string(local_base)}",
        '      api_key: "local"',
        "      extra_body:",
        "        chat_template_kwargs:",
        "          enable_thinking: false",
    ]
    if timeout is not None:
        lines.append(f"      timeout: {timeout}")
        lines.append(f"      stream_timeout: {timeout}")
    return lines


def render_config(root: Path, *, include_paid: bool, local_base: str, include_kimi: bool = False) -> str:
    """Exact-match disk cache on the drive. DeepSeek is omitted without a key.

    ``auto`` and ``local`` both use llama-server. ``auto`` alone may fall back
    to ``paid`` (an alias of ``deepseek-flash``) after an error or a 60 s
    timeout; a plain ``local`` request never reaches a paid model.
    ``deepseek-v4-pro`` is listed for an explicit request; it is not a fallback.
    """
    cache_dir = root / "cache" / "litellm"
    lines = ["model_list:"]
    lines.extend(_local_entry("local", local_base))
    lines.extend(_local_entry(AUTO_ALIAS, local_base, timeout=AUTO_TIMEOUT_S))
    if include_paid:
        lines.extend(_deepseek_entry("paid", FLASH_MODEL))
        lines.extend(_deepseek_entry(FLASH_MODEL, FLASH_MODEL))
        lines.extend(_deepseek_entry(PRO_MODEL, PRO_MODEL))
    if include_kimi:
        lines.extend(_kimi_entry("kimi", "high"))
        lines.extend(_kimi_entry("kimi-low", "low"))
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
                f"    - {AUTO_ALIAS}:",
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
        include_kimi=key_is_set(env.get("KIMI_API_KEY")),
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
