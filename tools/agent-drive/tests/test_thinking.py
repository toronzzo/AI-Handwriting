"""Thinking blocks never reach a caller, whole or streamed."""

from __future__ import annotations

from types import SimpleNamespace

from agent_drive.thinking import (
    ThinkStripper,
    chunk_text,
    set_chunk_text,
    strip_think,
    strip_think_from_response,
)


def test_plain_text_is_untouched() -> None:
    assert strip_think("Hello there.") == "Hello there."
    assert strip_think("") == ""


def test_complete_block_is_removed() -> None:
    assert strip_think("<think>secret</think>Visible answer") == "Visible answer"
    assert strip_think("before<think>x</think>after") == "beforeafter"
    assert strip_think("<think>a</think>one<think>b</think>two") == "onetwo"


def test_empty_block_is_removed() -> None:
    assert strip_think("<think>\n\n</think>\n\nHi.") == "Hi."


def test_case_and_attributes_are_tolerated() -> None:
    assert strip_think("<THINK>x</THINK>Hi.") == "Hi."
    assert strip_think("<think reason='x'>y</think>Hi.") == "Hi."


def test_unclosed_block_is_dropped() -> None:
    assert strip_think("<think>never closes") == ""


def test_stream_with_tag_in_one_chunk() -> None:
    stripper = ThinkStripper()
    out = stripper.feed("<think>secret</think>Hello")
    assert out == "Hello"
    assert stripper.flush() == ""


def test_stream_with_tag_split_across_chunks() -> None:
    stripper = ThinkStripper()
    pieces = ["<thi", "nk>hid", "den</thi", "nk>Vis", "ible answer"]
    out = "".join(stripper.feed(piece) for piece in pieces) + stripper.flush()
    assert out == "Visible answer"


def test_partial_opener_is_held_not_leaked() -> None:
    stripper = ThinkStripper()
    first = stripper.feed("Hello <thi")
    assert first == "Hello "
    rest = stripper.feed("nk>hidden</think>Answer")
    assert first + rest == "Hello Answer"
    assert "<think" not in first + rest


def test_lookalike_word_is_not_swallowed() -> None:
    # "<thing>" is not a reasoning tag, so it survives once it is complete.
    stripper = ThinkStripper()
    out = stripper.feed("Hello <thi") + stripper.feed("ng>wait") + stripper.flush()
    assert out == "Hello <thing>wait"


def test_unterminated_stream_block_is_dropped() -> None:
    stripper = ThinkStripper()
    assert stripper.feed("<think>no closer here") == ""
    assert stripper.flush() == ""


def test_stream_matches_whole_reply() -> None:
    body = "<think>step one</think>The answer is 42."
    for size in (1, 2, 3, 5, 8, 16):
        stripper = ThinkStripper()
        chunks = [body[i : i + size] for i in range(0, len(body), size)]
        out = "".join(stripper.feed(c) for c in chunks) + stripper.flush()
        assert out == "The answer is 42."


def _response(content: str) -> SimpleNamespace:
    return SimpleNamespace(
        choices=[SimpleNamespace(message=SimpleNamespace(content=content, role="assistant"))]
    )


def test_response_object_is_stripped() -> None:
    response = _response("<think>x</think>Hi.")
    assert strip_think_from_response(response) is True
    assert response.choices[0].message.content == "Hi."


def test_response_dict_is_stripped() -> None:
    response = {"choices": [{"message": {"content": "<think>x</think>Hi."}}]}
    assert strip_think_from_response(response) is True
    assert response["choices"][0]["message"]["content"] == "Hi."


def test_response_without_thinking_is_untouched() -> None:
    response = _response("Plain answer")
    assert strip_think_from_response(response) is False
    assert response.choices[0].message.content == "Plain answer"


def test_chunk_helpers_round_trip() -> None:
    chunk = {"choices": [{"delta": {"content": "abc"}}]}
    assert chunk_text(chunk) == "abc"
    set_chunk_text(chunk, "")
    assert chunk_text(chunk) == ""


def test_chunk_without_content_returns_none() -> None:
    assert chunk_text({"choices": [{"delta": {"role": "assistant"}}]}) is None
    assert chunk_text({"choices": []}) is None
