"""LiteLLM success callback. One history row pair and one JSON line per call.

Registered from the proxy config as ``agent_drive.callback.proxy_handler_instance``.
Failures are printed and swallowed so a logging error does not fail the model call.
"""

from __future__ import annotations

import sys
from typing import Any

from litellm.integrations.custom_logger import CustomLogger

from agent_drive.deepseek import (
    estimate_cost,
    is_deepseek_route,
    load_prefix,
    now_utc,
    offpeak_block_reason,
    with_stable_prefix,
)
from agent_drive.history import log_exchange
from agent_drive.logging_io import append_jsonl
from agent_drive.paths import agent_root
from agent_drive.secrets import deepseek_off_peak_only

_MAX_CHARS = 8000


def _clip(text: str) -> str:
    if len(text) <= _MAX_CHARS:
        return text
    return text[:_MAX_CHARS] + "…"


def _content_to_text(content: Any) -> str:
    if content is None:
        return ""
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts: list[str] = []
        for item in content:
            if isinstance(item, str):
                parts.append(item)
            elif isinstance(item, dict):
                parts.append(str(item.get("text") or item.get("content") or ""))
            else:
                parts.append(str(item))
        return "\n".join(part for part in parts if part)
    return str(content)


def _messages_text(messages: Any) -> str:
    if not isinstance(messages, list):
        return ""
    lines: list[str] = []
    for message in messages:
        if not isinstance(message, dict):
            continue
        role = str(message.get("role") or "user")
        lines.append(f"{role}: {_content_to_text(message.get('content'))}")
    return "\n".join(lines)


def _response_text(response: Any) -> str:
    if response is None:
        return ""
    if isinstance(response, dict):
        choices = response.get("choices") or []
        if choices and isinstance(choices[0], dict):
            message = choices[0].get("message") or {}
            if isinstance(message, dict):
                return _content_to_text(message.get("content"))
        return ""
    choices = getattr(response, "choices", None) or []
    if not choices:
        return ""
    message = getattr(choices[0], "message", None)
    return _content_to_text(getattr(message, "content", None))


def _usage_object(response: Any) -> Any:
    usage = getattr(response, "usage", None)
    if usage is None and isinstance(response, dict):
        usage = response.get("usage")
    return usage


def _usage_pair(response: Any, kwargs: dict[str, Any]) -> tuple[int | None, int | None]:
    usage = _usage_object(response)
    prompt = _usage_field(usage, "prompt_tokens")
    completion = _usage_field(usage, "completion_tokens")
    standard = kwargs.get("standard_logging_object") or {}
    if isinstance(standard, dict):
        if prompt is None and isinstance(standard.get("prompt_tokens"), int):
            prompt = standard["prompt_tokens"]
        if completion is None and isinstance(standard.get("completion_tokens"), int):
            completion = standard["completion_tokens"]
    return prompt, completion


def _cache_token_pair(response: Any) -> tuple[int | None, int | None]:
    usage = _usage_object(response)
    hit = _usage_field(usage, "prompt_cache_hit_tokens")
    miss = _usage_field(usage, "prompt_cache_miss_tokens")
    if hit is None:
        details = None
        if isinstance(usage, dict):
            details = usage.get("prompt_tokens_details")
        else:
            details = getattr(usage, "prompt_tokens_details", None)
        cached = _usage_field(details, "cached_tokens")
        if cached is not None:
            hit = cached
    return hit, miss


def _usage_field(usage: Any, name: str) -> int | None:
    if usage is None:
        return None
    if isinstance(usage, dict):
        value = usage.get(name)
    else:
        value = getattr(usage, name, None)
    if isinstance(value, bool) or value is None:
        return None
    if isinstance(value, int):
        return value
    return None


def _metadata(kwargs: dict[str, Any]) -> dict[str, Any]:
    params = kwargs.get("litellm_params") or {}
    if not isinstance(params, dict):
        return {}
    meta = params.get("metadata") or {}
    return meta if isinstance(meta, dict) else {}


def session_id_from(kwargs: dict[str, Any]) -> str:
    meta = _metadata(kwargs)
    if meta.get("session_id"):
        return str(meta["session_id"])[:80]
    standard = kwargs.get("standard_logging_object") or {}
    if isinstance(standard, dict) and standard.get("session_id"):
        return str(standard["session_id"])[:80]
    request = kwargs.get("proxy_server_request") or {}
    if isinstance(request, dict):
        headers = request.get("headers") or {}
        if isinstance(headers, dict):
            for key, value in headers.items():
                if str(key).lower() == "x-agent-session" and value:
                    return str(value)[:80]
    return "default"


def call_id_from(kwargs: dict[str, Any], response: Any) -> str | None:
    if kwargs.get("litellm_call_id"):
        return str(kwargs["litellm_call_id"])
    standard = kwargs.get("standard_logging_object") or {}
    if isinstance(standard, dict) and standard.get("id"):
        return str(standard["id"])
    hidden = getattr(response, "_hidden_params", None)
    if isinstance(hidden, dict) and hidden.get("litellm_call_id"):
        return str(hidden["litellm_call_id"])
    return None


def cache_hit_from(kwargs: dict[str, Any], response: Any) -> bool:
    if kwargs.get("cache_hit") is True:
        return True
    standard = kwargs.get("standard_logging_object") or {}
    if isinstance(standard, dict) and standard.get("cache_hit") is True:
        return True
    hidden = getattr(response, "_hidden_params", None)
    return isinstance(hidden, dict) and hidden.get("cache_hit") is True


def record_success(kwargs: dict[str, Any], response: Any) -> None:
    """Write the exchange. Safe to call twice for the same LiteLLM call id."""
    root = agent_root()
    session_id = session_id_from(kwargs)
    call_id = call_id_from(kwargs, response)
    cache_hit = cache_hit_from(kwargs, response)
    model = kwargs.get("model")
    model_name = str(model) if model else None
    prompt_tokens, completion_tokens = _usage_pair(response, kwargs)
    cache_hit_tokens, cache_miss_tokens = _cache_token_pair(response)
    priced = estimate_cost(
        model_name,
        prompt_tokens=prompt_tokens,
        completion_tokens=completion_tokens,
        cache_hit_tokens=cache_hit_tokens,
        cache_miss_tokens=cache_miss_tokens,
        moment=now_utc(),
    )
    user_text = _clip(_messages_text(kwargs.get("messages")))
    assistant_text = _clip(_response_text(response))
    stored = log_exchange(
        session_id=session_id,
        call_id=call_id,
        user_text=user_text,
        assistant_text=assistant_text,
        model=model_name,
        cache_hit=cache_hit,
        prompt_tokens=prompt_tokens,
        completion_tokens=completion_tokens,
        prompt_cache_hit_tokens=priced["prompt_cache_hit_tokens"] if isinstance(priced["prompt_cache_hit_tokens"], int) else None,
        prompt_cache_miss_tokens=priced["prompt_cache_miss_tokens"] if isinstance(priced["prompt_cache_miss_tokens"], int) else None,
        estimated_cost_usd=str(priced["estimated_cost_usd"]) if priced["estimated_cost_usd"] is not None else None,
        rate_window=str(priced["rate_window"]) if priced["rate_window"] else None,
        root=root,
    )
    if not stored:
        return
    append_jsonl(
        {
            "session_id": session_id,
            "call_id": call_id,
            "model": model_name,
            "cache_hit": cache_hit,
            "prompt_tokens": prompt_tokens,
            "completion_tokens": completion_tokens,
            "prompt_cache_hit_tokens": priced["prompt_cache_hit_tokens"],
            "prompt_cache_miss_tokens": priced["prompt_cache_miss_tokens"],
            "cache_token_source": priced["cache_token_source"],
            "estimated_cost_usd": priced["estimated_cost_usd"],
            "rate_window": priced["rate_window"],
            "pricing_model": priced["pricing_model"],
            "messages": user_text,
            "response": assistant_text,
        },
        root,
    )


class HistoryCallback(CustomLogger):
    def log_success_event(self, kwargs, response_obj, start_time, end_time):  # noqa: ANN001
        _safe_record(kwargs, response_obj)

    async def async_log_success_event(self, kwargs, response_obj, start_time, end_time):  # noqa: ANN001
        _safe_record(kwargs, response_obj)

    async def async_pre_call_hook(self, user_api_key_dict, cache, data, call_type):  # noqa: ANN001
        """Keep DeepSeek's prefix stable, and hold paid calls during peak when asked."""
        if not isinstance(data, dict):
            return data
        model = data.get("model")
        model_name = str(model) if model else ""
        root = agent_root()
        reason = offpeak_block_reason(model_name, now_utc(), deepseek_off_peak_only(root))
        if reason:
            return reason
        if is_deepseek_route(model_name) and isinstance(data.get("messages"), list):
            data["messages"] = with_stable_prefix(data["messages"], load_prefix(root))
        return data


def _safe_record(kwargs: Any, response_obj: Any) -> None:
    try:
        if not isinstance(kwargs, dict):
            return
        record_success(kwargs, response_obj)
    except Exception as exc:  # noqa: BLE001 - logging must not break the model call
        print(f"agent-drive history: {exc}", file=sys.stderr)


proxy_handler_instance = HistoryCallback()
