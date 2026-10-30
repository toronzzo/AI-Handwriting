"""A repeated request is served from the LiteLLM disk cache and both calls are logged."""

from __future__ import annotations

import asyncio
import json
import sqlite3
from pathlib import Path

import litellm
from litellm import Cache
from litellm.caching.caching_handler import _PENDING_CACHE_WRITES
from litellm.litellm_core_utils.logging_worker import GLOBAL_LOGGING_WORKER

from agent_drive.callback import proxy_handler_instance
from agent_drive.history import history_db_path
from tests.fake_openai import FakeOpenAI


def _reset_callbacks() -> None:
    litellm.callbacks = []
    litellm.success_callback = []
    litellm.failure_callback = []
    litellm._async_success_callback = []
    litellm._async_failure_callback = []
    litellm.input_callback = []
    litellm.cache = None


def test_repeat_is_disk_cache_hit_and_history_is_written(tmp_path: Path, monkeypatch) -> None:
    root = tmp_path / "drive"
    root.mkdir()
    monkeypatch.setenv("AGENT_DRIVE_ROOT", str(root))
    fake = FakeOpenAI().start()
    _reset_callbacks()
    litellm.suppress_debug_info = True
    litellm.cache = Cache(type="disk", disk_cache_dir=str(root / "cache" / "litellm"))
    # Same registration the proxy config uses: litellm.callbacks.
    litellm.callbacks = [proxy_handler_instance]
    messages = [{"role": "user", "content": "cache-me-please"}]
    common = dict(
        model="openai/local",
        api_base=fake.base_url,
        api_key="local",
        messages=messages,
        caching=True,
        metadata={"session_id": "ses_cache"},
    )

    async def _run() -> object:
        try:
            await litellm.acompletion(**common)
            pending = list(_PENDING_CACHE_WRITES)
            if pending:
                await asyncio.wait(pending, timeout=5)
            await GLOBAL_LOGGING_WORKER.flush()
            second = await litellm.acompletion(**common)
            await GLOBAL_LOGGING_WORKER.flush()
            return second
        finally:
            fake.close()
            _reset_callbacks()

    second = asyncio.run(_run())
    hidden = getattr(second, "_hidden_params", {}) or {}
    assert fake.hits == 1
    assert hidden.get("cache_hit") is True
    assert second.choices[0].message.content == "reply-1"

    db = history_db_path(root)
    conn = sqlite3.connect(db)
    conn.row_factory = sqlite3.Row
    try:
        rows = conn.execute(
            "SELECT role, cache_hit, content, session_id FROM messages ORDER BY id"
        ).fetchall()
    finally:
        conn.close()
    assert rows, "history callback wrote no rows"
    assert {row["session_id"] for row in rows} == {"ses_cache"}
    assistants = [row for row in rows if row["role"] == "assistant"]
    assert [row["content"] for row in assistants] == ["reply-1", "reply-1"]
    assert [row["cache_hit"] for row in assistants] == [0, 1]

    log_path = root / "logs" / "gateway.jsonl"
    events = [json.loads(line) for line in log_path.read_text(encoding="utf-8").splitlines() if line.strip()]
    assert len(events) == 2
    assert events[0]["cache_hit"] is False
    assert events[1]["cache_hit"] is True
    assert events[1]["response"] == "reply-1"
