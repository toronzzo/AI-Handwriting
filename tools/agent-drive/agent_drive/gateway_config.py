"""Render the LiteLLM proxy config. Secrets stay in the environment, not the file."""

from __future__ import annotations

import os
import re
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
# Free vision ids the screen helper asks the gateway for. Override in secrets
# with GROQ_VISION_MODEL or GEMINI_VISION_MODEL if a provider renames them.
DEFAULT_GROQ_VISION = "meta-llama/llama-4-scout-17b-16e-instruct"
DEFAULT_GEMINI_VISION = "gemini-2.5-flash"
_MODEL_ID = re.compile(r"[A-Za-z0-9_./:-]{1,160}")
_ENV_NAME = re.compile(r"[A-Z][A-Z0-9_]{0,60}")


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


def _safe_model_id(value: str | None, default: str) -> str:
    text = (value or "").strip()
    if _MODEL_ID.fullmatch(text):
        return text
    return default


def _safe_env_name(value: str | None, default: str) -> str:
    text = (value or "").strip()
    if _ENV_NAME.fullmatch(text):
        return text
    return default


def _provider_model(provider: str, upstream: str) -> str:
    prefix = provider + "/"
    if upstream.startswith(prefix):
        return upstream
    return prefix + upstream


def _groq_vision_entry(upstream: str) -> list[str]:
    """Explicit free Groq vision route. Not a fallback for text chat."""
    return [
        "  - model_name: groq-vision",
        "    litellm_params:",
        f"      model: {_yaml_string(_provider_model('groq', upstream))}",
        "      api_key: os.environ/GROQ_API_KEY",
        "    model_info:",
        "      input_cost_per_token: 0",
        "      output_cost_per_token: 0",
    ]


def _gemini_vision_entry(upstream: str, key_env: str) -> list[str]:
    """Explicit Gemini free vision route. Not a fallback for text chat."""
    return [
        "  - model_name: gemini-flash",
        "    litellm_params:",
        f"      model: {_yaml_string(_provider_model('gemini', upstream))}",
        f"      api_key: os.environ/{_safe_env_name(key_env, 'GEMINI_API_KEY')}",
        "    model_info:",
        "      input_cost_per_token: 0",
        "      output_cost_per_token: 0",
    ]


def render_config(
    root: Path,
    *,
    include_paid: bool,
    local_base: str,
    include_kimi: bool = False,
    include_groq: bool = False,
    include_gemini: bool = False,
    groq_vision_model: str = DEFAULT_GROQ_VISION,
    gemini_vision_model: str = DEFAULT_GEMINI_VISION,
    gemini_key_env: str = "GEMINI_API_KEY",
) -> str:
    """Exact-match disk cache on the drive. DeepSeek is omitted without a key.

    ``auto`` and ``local`` both use llama-server. ``auto`` alone may fall back
    to ``paid`` (an alias of ``deepseek-flash``) after an error or a 60 s
    timeout; a plain ``local`` request never reaches a paid model.
    ``deepseek-v4-pro`` is listed for an explicit request; it is not a fallback.
    ``groq-vision`` and ``gemini-flash`` are also explicit only, and only when
    that provider's key is set. They are never fallbacks.
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
    if include_groq:
        lines.extend(_groq_vision_entry(_safe_model_id(groq_vision_model, DEFAULT_GROQ_VISION)))
    if include_gemini:
        lines.extend(
            _gemini_vision_entry(
                _safe_model_id(gemini_vision_model, DEFAULT_GEMINI_VISION),
                gemini_key_env,
            )
        )
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
    gemini_key_env = "GEMINI_API_KEY" if key_is_set(env.get("GEMINI_API_KEY")) else "GOOGLE_API_KEY"
    text = render_config(
        root,
        include_paid=include_paid,
        local_base=local_api_base(),
        include_kimi=key_is_set(env.get("KIMI_API_KEY")),
        include_groq=key_is_set(env.get("GROQ_API_KEY")) or key_is_set(env.get("PREYAS_FREE_CLOUD_KEY")),
        include_gemini=key_is_set(env.get("GEMINI_API_KEY")) or key_is_set(env.get("GOOGLE_API_KEY")),
        groq_vision_model=_safe_model_id(env.get("GROQ_VISION_MODEL"), DEFAULT_GROQ_VISION),
        gemini_vision_model=_safe_model_id(env.get("GEMINI_VISION_MODEL"), DEFAULT_GEMINI_VISION),
        gemini_key_env=gemini_key_env,
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
