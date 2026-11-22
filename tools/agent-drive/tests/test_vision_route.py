"""Groq and Gemini vision routes are explicit, key-gated, and never a fallback."""

from agent_drive.callback import _messages_text
from agent_drive.gateway_config import DEFAULT_GEMINI_VISION, DEFAULT_GROQ_VISION, render_config

BASE = "http://127.0.0.1:8788/v1"


def test_vision_routes_absent_without_keys(tmp_path):
    text = render_config(tmp_path, include_paid=True, local_base=BASE)
    assert "groq-vision" not in text
    assert "gemini-flash" not in text
    assert "GROQ_API_KEY" not in text
    assert "GEMINI_API_KEY" not in text


def test_vision_routes_when_keys_are_set_and_the_key_stays_out_of_the_file(tmp_path):
    secret = "gsk_live-example-do-not-leak"
    text = render_config(
        tmp_path,
        include_paid=False,
        local_base=BASE,
        include_groq=True,
        include_gemini=True,
        gemini_key_env="GOOGLE_API_KEY",
    )
    assert "model_name: groq-vision" in text
    assert "model_name: gemini-flash" in text
    assert f'model: "groq/{DEFAULT_GROQ_VISION}"' in text
    assert f'model: "gemini/{DEFAULT_GEMINI_VISION}"' in text
    assert "os.environ/GROQ_API_KEY" in text
    assert "os.environ/GOOGLE_API_KEY" in text
    assert "input_cost_per_token: 0" in text
    assert secret not in text
    assert "fallbacks:" not in text


def test_vision_is_never_a_fallback(tmp_path):
    text = render_config(
        tmp_path,
        include_paid=True,
        local_base=BASE,
        include_groq=True,
        include_gemini=True,
    )
    fallbacks = text.split("router_settings:", 1)[1]
    assert "groq-vision" not in fallbacks
    assert "gemini" not in fallbacks
    assert "- paid" in fallbacks


def test_a_broken_model_id_falls_back_to_the_default(tmp_path):
    text = render_config(
        tmp_path,
        include_paid=False,
        local_base=BASE,
        include_groq=True,
        groq_vision_model="bad\nmodel",
    )
    assert "bad" not in text
    assert DEFAULT_GROQ_VISION in text


def test_history_text_drops_image_bytes():
    payload = "data:image/jpeg;base64," + ("A" * 80)
    text = _messages_text(
        [
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": "what is this"},
                    {"type": "image_url", "image_url": {"url": payload}},
                ],
            }
        ]
    )
    assert "what is this" in text
    assert "[image]" in text
    assert payload not in text
    assert "AAAA" not in text
