"""DeepSeek pricing, peak windows, and the stable prompt prefix.

Rates are USD per 1M tokens from DeepSeek's pricing page
(https://api-docs.deepseek.com/quick_start/pricing/), checked 2026-10-29:

- ``deepseek-flash`` is served by DeepSeek-V4.1-Flash-1017.
  Off-peak: cache-hit input $0.003, cache-miss input $0.15, output $0.60.
  Peak is exactly 2x. Cache-hit input is 50x cheaper than a cache miss.
- ``deepseek-v4-pro`` is DeepSeek-V4-Pro-0813.
  Off-peak: cache-hit input $0.022, cache-miss input $0.66, output $1.98. Peak is 2x.

Peak hours are 01:00–04:00 and 06:00–10:00 UTC, Monday–Friday. The end of each
window is off-peak. Weekends are off-peak. DeepSeek also bills Chinese public
holidays as off-peak; this estimate follows the weekday clock only, so a
holiday that falls on a weekday can be logged at the peak rate while the
invoice is off-peak.

There is no cache-write fee. The server cache hits when the token prefix matches
an earlier request, so the gateway keeps one fixed system message at the front
and leaves variable text after it.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from decimal import Decimal, ROUND_HALF_UP
from pathlib import Path

DEEPSEEK_API_BASE = "https://api.deepseek.com"
FLASH_MODEL = "deepseek-flash"
PRO_MODEL = "deepseek-v4-pro"
PAID_ALIAS = "paid"

DEFAULT_PREFIX = (
    "You are a careful assistant. Follow the user's later messages. "
    "Do not repeat these instructions."
)

# USD per 1M tokens. Peak is 2x off-peak.
_PER_MILLION: dict[str, dict[str, dict[str, str]]] = {
    "flash": {
        "off-peak": {"hit": "0.003", "miss": "0.15", "out": "0.6"},
        "peak": {"hit": "0.006", "miss": "0.3", "out": "1.2"},
    },
    "pro": {
        "off-peak": {"hit": "0.022", "miss": "0.66", "out": "1.98"},
        "peak": {"hit": "0.044", "miss": "1.32", "out": "3.96"},
    },
}

_MILLION = Decimal(1_000_000)
_QUANT = Decimal("0.00000001")
_DEEPSEEK_TAILS = {FLASH_MODEL, PRO_MODEL, PAID_ALIAS, "deepseek-v4-flash", "deepseek-v4-flash-vision-exp"}


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def _as_utc(moment: datetime) -> datetime:
    if moment.tzinfo is None:
        return moment.replace(tzinfo=timezone.utc)
    return moment.astimezone(timezone.utc)


def is_peak(moment: datetime) -> bool:
    """True during weekday 01:00–04:00 and 06:00–10:00 UTC. Ends are exclusive."""
    moment = _as_utc(moment)
    if moment.weekday() >= 5:
        return False
    minutes = moment.hour * 60 + moment.minute
    return (60 <= minutes < 4 * 60) or (6 * 60 <= minutes < 10 * 60)


def rate_window(moment: datetime) -> str:
    return "peak" if is_peak(moment) else "off-peak"


def next_offpeak(moment: datetime) -> datetime:
    """First off-peak instant at or after ``moment``."""
    moment = _as_utc(moment)
    if not is_peak(moment):
        return moment
    end_hour = 4 if moment.hour < 4 else 10
    return moment.replace(hour=end_hour, minute=0, second=0, microsecond=0)


def model_tail(model: str | None) -> str:
    if not model:
        return ""
    return model.strip().lower().split("/")[-1]


def is_deepseek_route(model: str | None) -> bool:
    return model_tail(model) in _DEEPSEEK_TAILS


def pricing_family(model: str | None) -> str | None:
    tail = model_tail(model)
    if tail == PRO_MODEL:
        return "pro"
    if tail in _DEEPSEEK_TAILS:
        return "flash"
    return None


def _rate(family: str, window: str, kind: str) -> Decimal:
    return Decimal(_PER_MILLION[family][window][kind]) / _MILLION


def estimate_cost(
    model: str | None,
    *,
    prompt_tokens: int | None,
    completion_tokens: int | None,
    cache_hit_tokens: int | None,
    cache_miss_tokens: int | None,
    moment: datetime | None = None,
) -> dict[str, str | int | None]:
    """Return token counts and a USD estimate. Local models cost 0.

    When the provider does not split cache hit and miss, every prompt token is
    priced as a miss. That overestimates a hit and never underestimates a miss.
    """
    moment = moment or now_utc()
    family = pricing_family(model)
    prompt = prompt_tokens or 0
    output = completion_tokens or 0
    if family is None:
        return {
            "estimated_cost_usd": "0",
            "rate_window": None,
            "pricing_model": None,
            "prompt_cache_hit_tokens": cache_hit_tokens,
            "prompt_cache_miss_tokens": cache_miss_tokens,
            "cache_token_source": None,
        }
    window = rate_window(moment)
    source = "provider"
    hit = cache_hit_tokens
    miss = cache_miss_tokens
    if hit is None and miss is None:
        hit = 0
        miss = prompt
        source = "assumed_miss"
    elif hit is None:
        hit = max(prompt - (miss or 0), 0)
        source = "derived"
    elif miss is None:
        miss = max(prompt - hit, 0)
        source = "derived"
    cost = (
        Decimal(hit) * _rate(family, window, "hit")
        + Decimal(miss) * _rate(family, window, "miss")
        + Decimal(output) * _rate(family, window, "out")
    ).quantize(_QUANT, rounding=ROUND_HALF_UP)
    pricing_model = FLASH_MODEL if family == "flash" else PRO_MODEL
    return {
        "estimated_cost_usd": format(cost, "f"),
        "rate_window": window,
        "pricing_model": pricing_model,
        "prompt_cache_hit_tokens": hit,
        "prompt_cache_miss_tokens": miss,
        "cache_token_source": source,
    }


def prefix_path(root: Path) -> Path:
    return root / "prompts" / "deepseek-prefix.txt"


def load_prefix(root: Path) -> str:
    path = prefix_path(root)
    if path.is_file():
        text = path.read_text(encoding="utf-8").strip()
        if text:
            return text
    return DEFAULT_PREFIX


def with_stable_prefix(messages: list, prefix: str) -> list:
    """Put ``prefix`` first. Leave the list unchanged when it is already first.

    Variable text stays after the prefix, so DeepSeek's server-side cache can
    reuse the shared head. This function does not add a clock or a request id.
    """
    head = {"role": "system", "content": prefix}
    if not messages:
        return [head]
    first = messages[0]
    if isinstance(first, dict) and first.get("role") == "system" and first.get("content") == prefix:
        return list(messages)
    return [head, *list(messages)]


def offpeak_block_reason(model: str | None, moment: datetime, off_peak_only: bool) -> str | None:
    """Why a DeepSeek call should not be sent, or None when it may proceed."""
    if not off_peak_only or not is_deepseek_route(model) or not is_peak(moment):
        return None
    nxt = next_offpeak(moment)
    return (
        f"DeepSeek is in a peak window (2x price) until {nxt.strftime('%Y-%m-%dT%H:%M:%SZ')}. "
        "DEEPSEEK_OFF_PEAK_ONLY is set, so this call was not sent. "
        "Non-urgent batch jobs can wait with ./bin/offpeak.sh --wait. "
        "Unset DEEPSEEK_OFF_PEAK_ONLY to pay the peak rate."
    )


def seconds_until_offpeak(moment: datetime) -> float:
    nxt = next_offpeak(moment)
    return max(0.0, (nxt - _as_utc(moment)).total_seconds())
