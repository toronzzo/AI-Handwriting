"""Minimal OpenAI-compatible chat call. Used by summarize, not by the proxy."""

from __future__ import annotations

import json
import urllib.error
import urllib.request
from typing import Any


class ChatError(Exception):
    """The local model did not answer."""


def chat_completion(
    *,
    base_url: str,
    model: str,
    messages: list[dict[str, str]],
    timeout: float = 120,
) -> str:
    url = base_url.rstrip("/") + "/chat/completions"
    body = json.dumps({"model": model, "messages": messages, "temperature": 0}).encode("utf-8")
    request = urllib.request.Request(
        url,
        data=body,
        headers={"Content-Type": "application/json", "Authorization": "Bearer local"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            payload: dict[str, Any] = json.loads(response.read().decode("utf-8"))
    except urllib.error.URLError as exc:
        raise ChatError(f"Could not reach {url}: {exc.reason}") from None
    except TimeoutError:
        raise ChatError(f"Timed out waiting for {url}") from None
    try:
        text = payload["choices"][0]["message"]["content"]
    except (KeyError, IndexError, TypeError) as exc:
        raise ChatError("The model response had no message content.") from exc
    if not isinstance(text, str) or not text.strip():
        raise ChatError("The model returned an empty summary.")
    return text.strip()
