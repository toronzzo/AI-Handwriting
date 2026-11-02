"""The ``auto`` route is the only one allowed to reach a paid model."""

from __future__ import annotations

import asyncio
import json
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import pytest

litellm = pytest.importorskip("litellm")  # noqa: F841 - the callback subclasses CustomLogger

from agent_drive import callback as callback_module
from agent_drive.callback import HistoryCallback, record_fallback
from agent_drive.gateway_config import AUTO_ALIAS, render_config


def _block(text: str, name: str) -> str:
    """The model_list entry for one name, up to the next entry."""
    start = text.index(f"  - model_name: {name}")
    rest = text[start + 1 :]
    end = rest.find("  - model_name:")
    return text[start:] if end < 0 else text[start : start + 1 + end]


def _local_base() -> str:
    return "http://127.0.0.1:8788/v1"


def test_auto_route_exists_and_times_out_at_60s(tmp_path: Path) -> None:
    text = render_config(tmp_path, include_paid=True, local_base=_local_base())
    auto = _block(text, AUTO_ALIAS)
    assert "model: openai/local" in auto
    assert "timeout: 60" in auto
    assert "stream_timeout: 60" in auto
    assert "enable_thinking: false" in auto


def test_local_and_auto_turn_thinking_off(tmp_path: Path) -> None:
    text = render_config(tmp_path, include_paid=True, local_base=_local_base())
    for name in ("local", AUTO_ALIAS):
        block = _block(text, name)
        assert "chat_template_kwargs:" in block
        assert "enable_thinking: false" in block


def test_only_auto_falls_back_to_paid(tmp_path: Path) -> None:
    text = render_config(tmp_path, include_paid=True, local_base=_local_base())
    fallback = text.split("fallbacks:", 1)[1]
    assert f"- {AUTO_ALIAS}:" in fallback
    assert "- paid" in fallback
    assert "- local:" not in fallback


def test_no_fallback_without_a_key(tmp_path: Path) -> None:
    text = render_config(tmp_path, include_paid=False, local_base=_local_base())
    assert f"model_name: {AUTO_ALIAS}" in text
    assert "fallbacks:" not in text
    assert "paid" not in text


def test_record_fallback_writes_a_line(tmp_path: Path) -> None:
    record_fallback("local timed out after 60s", root=tmp_path)
    log = tmp_path / "logs" / "gateway.jsonl"
    row = json.loads(log.read_text(encoding="utf-8").strip().splitlines()[-1])
    assert row["event"] == "fallback"
    assert row["from"] == AUTO_ALIAS
    assert row["to"] == "paid"
    assert "60s" in row["reason"]


def test_failure_hook_logs_only_for_auto(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(callback_module, "agent_root", lambda: tmp_path)
    log = tmp_path / "logs" / "gateway.jsonl"
    callback_module._safe_fallback(
        {"model": "local", "standard_logging_object": {"model_group": "local"}}, Exception("x")
    )
    assert not log.exists()
    callback_module._safe_fallback(
        {"model": "local", "standard_logging_object": {"model_group": "auto"}}, Exception("connection refused")
    )
    row = json.loads(log.read_text(encoding="utf-8").strip().splitlines()[-1])
    assert row["event"] == "fallback"
    assert "connection refused" in row["reason"]


def test_pre_call_forces_thinking_off_on_local_routes(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(callback_module, "agent_root", lambda: tmp_path)
    hook = HistoryCallback()
    for name in ("local", AUTO_ALIAS):
        data: dict[str, Any] = {"model": name, "messages": [{"role": "user", "content": "hi"}]}
        out = asyncio.run(hook.async_pre_call_hook(None, None, data, "completion"))
        assert out is data
        assert data["chat_template_kwargs"] == {"enable_thinking": False}


def test_post_call_hook_strips_reasoning() -> None:
    hook = HistoryCallback()
    response = SimpleNamespace(
        choices=[SimpleNamespace(message=SimpleNamespace(content="<think>x</think>Hi.", role="assistant"))]
    )
    out = asyncio.run(hook.async_post_call_success_hook({}, None, response))
    assert out.choices[0].message.content == "Hi."


def test_streaming_hook_strips_reasoning_across_chunks() -> None:
    hook = HistoryCallback()

    async def upstream():
        for piece in ["<thi", "nk>hid", "den</thi", "nk>Hi", "."]:
            yield SimpleNamespace(
                choices=[SimpleNamespace(delta=SimpleNamespace(content=piece))]
            )

    async def collect() -> str:
        out = []
        async for chunk in hook.async_post_call_streaming_iterator_hook(None, upstream(), {}):
            out.append(chunk.choices[0].delta.content)
        return "".join(out)

    assert asyncio.run(collect()) == "Hi."
