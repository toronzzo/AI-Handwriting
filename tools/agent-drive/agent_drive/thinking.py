"""Remove Qwen3 reasoning blocks from replies, whole or streamed.

llama-server keeps the ``<think>...</think>`` block inside ``content`` unless the
chat template is told to skip it. The gateway asks for
``chat_template_kwargs.enable_thinking: false`` on the local routes, but a
client can send its own body, so these helpers are the guarantee: whatever a
caller receives from ``local`` or ``auto`` carries no reasoning text.

The streaming helper is stateful because a tag can be split across chunks
(``"<thi"`` then ``"nk>..."``) and a partial tag must never reach the client.
"""

from __future__ import annotations

import re
from typing import Any

_OPEN = "<think"
_CLOSE = "</think>"
_OPEN_RE = re.compile(r"<think\b[^>]*>", re.IGNORECASE)
_CLOSE_RE = re.compile(r"</think\s*>", re.IGNORECASE)


def strip_think(text: str) -> str:
    """Drop complete ``<think>...</think>`` blocks and any unclosed opener."""
    if not text:
        return text
    lower = text.lower()
    if _OPEN not in lower and _CLOSE not in lower:
        return text
    out = re.sub(r"<think\b[^>]*>.*?</think\s*>", "", text, flags=re.DOTALL | re.IGNORECASE)
    out = re.sub(r"<think\b[^>]*>.*$", "", out, flags=re.DOTALL | re.IGNORECASE)
    out = _CLOSE_RE.sub("", out)
    return out.strip()


class ThinkStripper:
    """Incremental ``strip_think`` for a stream of text pieces.

    Feed every chunk, emit what is safe, and call :meth:`flush` at the end.
    Text between an opener and its closer is dropped, including a reasoning
    block that never closes.
    """

    def __init__(self) -> None:
        self._buf = ""
        self._in_think = False

    def feed(self, text: str) -> str:
        if not text:
            return ""
        self._buf += text
        out: list[str] = []
        while True:
            if self._in_think:
                index = self._buf.lower().find(_CLOSE)
                if index < 0:
                    # Keep only a possible partial closer, discard the rest.
                    keep = self._partial_suffix(_CLOSE)
                    self._buf = self._buf[-keep:] if keep else ""
                    break
                self._buf = self._buf[index + len(_CLOSE) :]
                self._in_think = False
                continue

            index = self._buf.lower().find(_OPEN)
            if index < 0:
                keep = self._partial_suffix(_OPEN)
                if keep:
                    out.append(self._buf[:-keep])
                    self._buf = self._buf[-keep:]
                else:
                    out.append(self._buf)
                    self._buf = ""
                break

            if index > 0:
                out.append(self._buf[:index])
            end = self._buf.find(">", index)
            if end < 0:
                # An opener split across chunks: wait for the rest.
                self._buf = self._buf[index:]
                break
            self._buf = self._buf[end + 1 :]
            self._in_think = True
        return "".join(out)

    def flush(self) -> str:
        """Emit any held text. An unterminated reasoning block is dropped."""
        if self._in_think:
            self._buf = ""
            return ""
        rest, self._buf = self._buf, ""
        return rest

    def _partial_suffix(self, tag: str) -> int:
        lowered = self._buf.lower()
        limit = min(len(tag) - 1, len(lowered))
        for size in range(limit, 0, -1):
            if lowered.endswith(tag[:size].lower()):
                return size
        return 0


def _choices(response: Any) -> Any:
    if isinstance(response, dict):
        return response.get("choices") or []
    return getattr(response, "choices", None) or []


def _field(obj: Any, name: str) -> Any:
    if isinstance(obj, dict):
        return obj.get(name)
    return getattr(obj, name, None)


def _set_field(obj: Any, name: str, value: Any) -> None:
    if isinstance(obj, dict):
        obj[name] = value
    else:
        setattr(obj, name, value)


def strip_think_from_response(response: Any) -> bool:
    """Strip reasoning from every choice of a non-streaming LiteLLM response.

    Works on dicts and on ``ModelResponse`` objects. Returns True when a reply
    changed and logs nothing: the caller decides whether that matters.
    """
    changed = False
    for choice in _choices(response):
        message = _field(choice, "message")
        if message is None:
            continue
        content = _field(message, "content")
        if not isinstance(content, str):
            continue
        cleaned = strip_think(content)
        if cleaned != content:
            _set_field(message, "content", cleaned)
            changed = True
    return changed


def chunk_text(chunk: Any) -> str | None:
    """The delta content of a streaming chunk, or None when it carries none."""
    choices = _choices(chunk)
    if not choices:
        return None
    delta = _field(choices[0], "delta")
    if delta is None:
        return None
    content = _field(delta, "content")
    return content if isinstance(content, str) else None


def set_chunk_text(chunk: Any, text: str) -> None:
    choices = _choices(chunk)
    if not choices:
        return
    delta = _field(choices[0], "delta")
    if delta is None:
        return
    _set_field(delta, "content", text)
