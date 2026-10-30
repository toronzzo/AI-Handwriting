"""Peak windows, the 50x cache discount, a stable prefix, and the off-peak wait."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from decimal import Decimal
from pathlib import Path

from agent_drive.callback import record_success
from agent_drive.deepseek import (
    DEFAULT_PREFIX,
    estimate_cost,
    is_peak,
    next_offpeak,
    offpeak_block_reason,
    with_stable_prefix,
)
from agent_drive.history import history_db_path
from agent_drive.offpeak import wait_until_offpeak
import sqlite3


def _utc(year: int, month: int, day: int, hour: int, minute: int = 0) -> datetime:
    return datetime(year, month, day, hour, minute, tzinfo=timezone.utc)


def test_weekday_peak_windows_and_weekend_off_peak() -> None:
    thursday = 29  # 2026-10-29
    assert is_peak(_utc(2026, 10, thursday, 0, 30)) is False
    assert is_peak(_utc(2026, 10, thursday, 1, 0)) is True
    assert is_peak(_utc(2026, 10, thursday, 3, 59)) is True
    assert is_peak(_utc(2026, 10, thursday, 4, 0)) is False
    assert is_peak(_utc(2026, 10, thursday, 5, 30)) is False
    assert is_peak(_utc(2026, 10, thursday, 6, 0)) is True
    assert is_peak(_utc(2026, 10, thursday, 9, 59)) is True
    assert is_peak(_utc(2026, 10, thursday, 10, 0)) is False
    assert is_peak(_utc(2026, 10, 31, 2, 0)) is False  # Saturday
    assert next_offpeak(_utc(2026, 10, thursday, 2, 15)) == _utc(2026, 10, thursday, 4, 0)
    assert next_offpeak(_utc(2026, 10, thursday, 7, 0)) == _utc(2026, 10, thursday, 10, 0)
    assert next_offpeak(_utc(2026, 10, thursday, 12, 0)) == _utc(2026, 10, thursday, 12, 0)


def test_flash_cache_hit_is_fifty_times_cheaper_and_peak_is_double() -> None:
    off = _utc(2026, 10, 31, 12, 0)  # Saturday
    peak = _utc(2026, 10, 29, 2, 0)
    hit = estimate_cost(
        "deepseek-flash",
        prompt_tokens=1_000_000,
        completion_tokens=0,
        cache_hit_tokens=1_000_000,
        cache_miss_tokens=0,
        moment=off,
    )
    miss = estimate_cost(
        "paid",
        prompt_tokens=1_000_000,
        completion_tokens=0,
        cache_hit_tokens=0,
        cache_miss_tokens=1_000_000,
        moment=off,
    )
    peak_miss = estimate_cost(
        "openai/deepseek-flash",
        prompt_tokens=1_000_000,
        completion_tokens=0,
        cache_hit_tokens=0,
        cache_miss_tokens=1_000_000,
        moment=peak,
    )
    assert Decimal(hit["estimated_cost_usd"]) == Decimal("0.003")
    assert Decimal(miss["estimated_cost_usd"]) == Decimal("0.15")
    assert Decimal(miss["estimated_cost_usd"]) / Decimal(hit["estimated_cost_usd"]) == 50
    assert Decimal(peak_miss["estimated_cost_usd"]) == Decimal("0.3")
    assert Decimal(peak_miss["estimated_cost_usd"]) / Decimal(miss["estimated_cost_usd"]) == 2
    pro = estimate_cost(
        "deepseek-v4-pro",
        prompt_tokens=1_000_000,
        completion_tokens=1_000_000,
        cache_hit_tokens=0,
        cache_miss_tokens=1_000_000,
        moment=off,
    )
    assert Decimal(pro["estimated_cost_usd"]) == Decimal("0.66") + Decimal("1.98")
    local = estimate_cost(
        "local",
        prompt_tokens=100,
        completion_tokens=20,
        cache_hit_tokens=None,
        cache_miss_tokens=None,
        moment=peak,
    )
    assert local["estimated_cost_usd"] == "0"
    assert local["rate_window"] is None


def test_prefix_stays_first_and_is_not_duplicated() -> None:
    prefixed = with_stable_prefix([{"role": "user", "content": "task at 2026-10-29"}], DEFAULT_PREFIX)
    assert prefixed[0] == {"role": "system", "content": DEFAULT_PREFIX}
    assert prefixed[1]["content"] == "task at 2026-10-29"
    again = with_stable_prefix(prefixed, DEFAULT_PREFIX)
    assert again == prefixed
    assert DEFAULT_PREFIX == (
        Path(__file__).resolve().parents[1] / "templates" / "deepseek-prefix.txt"
    ).read_text(encoding="utf-8").strip()
    kept = with_stable_prefix(
        [{"role": "system", "content": "custom stable rules"}, {"role": "user", "content": "go"}],
        DEFAULT_PREFIX,
    )
    assert kept[0]["content"] == DEFAULT_PREFIX
    assert kept[1]["content"] == "custom stable rules"


def test_offpeak_only_blocks_deepseek_during_peak_and_wait_ends() -> None:
    peak = _utc(2026, 10, 29, 3, 0)
    reason = offpeak_block_reason("deepseek-flash", peak, True)
    assert reason is not None
    assert "2026-10-29T04:00:00Z" in reason
    assert offpeak_block_reason("local", peak, True) is None
    assert offpeak_block_reason("deepseek-v4-pro", peak, False) is None
    assert offpeak_block_reason("paid", _utc(2026, 10, 31, 3, 0), True) is None

    clock = [peak]

    def now() -> datetime:
        return clock[0]

    def sleep(seconds: float) -> None:
        clock[0] = clock[0] + timedelta(seconds=seconds)

    wait_until_offpeak(now=now, sleep=sleep)
    assert clock[0] == _utc(2026, 10, 29, 4, 0)


def test_history_logs_tokens_and_estimated_cost(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setenv("AGENT_DRIVE_ROOT", str(tmp_path))
    monkeypatch.setattr(
        "agent_drive.callback.now_utc",
        lambda: _utc(2026, 10, 31, 15, 0),
    )

    class Usage:
        prompt_tokens = 1_000_000
        completion_tokens = 0
        prompt_cache_hit_tokens = 1_000_000
        prompt_cache_miss_tokens = 0

    class Message:
        content = "ok"

    class Choice:
        message = Message()

    class Response:
        choices = [Choice()]
        usage = Usage()

    record_success(
        {
            "model": "deepseek-flash",
            "messages": [{"role": "user", "content": "hi"}],
            "litellm_call_id": "call-cost",
            "litellm_params": {"metadata": {"session_id": "ses_cost"}},
        },
        Response(),
    )
    conn = sqlite3.connect(history_db_path(tmp_path))
    conn.row_factory = sqlite3.Row
    row = conn.execute(
        "SELECT estimated_cost_usd, rate_window, prompt_cache_hit_tokens, prompt_tokens FROM messages WHERE role = 'assistant'"
    ).fetchone()
    assert row["estimated_cost_usd"] == "0.00300000"
    assert row["rate_window"] == "off-peak"
    assert row["prompt_cache_hit_tokens"] == 1_000_000
    assert row["prompt_tokens"] == 1_000_000
