"""DeepSeek is the paid fallback only when DEEPSEEK_API_KEY is set, and the key stays out of the file."""

from __future__ import annotations

from pathlib import Path

from agent_drive.gateway_config import render_config
from agent_drive.llama_cache import flags, slot_request
from agent_drive.secrets import deepseek_off_peak_only, key_is_set, paid_key_present


def test_disk_cache_and_no_paid_model_without_a_key(tmp_path: Path) -> None:
    text = render_config(tmp_path, include_paid=False, local_base="http://127.0.0.1:8788/v1")
    assert "model_name: local" in text
    assert "http://127.0.0.1:8788/v1" in text
    assert "type: disk" in text
    assert str(tmp_path / "cache" / "litellm") in text
    assert "agent_drive.callback.proxy_handler_instance" in text
    assert "json_logs: true" in text
    assert "dangerously_permit_weak_or_unset_master_key: true" in text
    assert "model_name: paid" not in text
    assert "deepseek" not in text
    assert "fallbacks:" not in text


def test_paid_fallback_is_deepseek_and_hides_the_key(tmp_path: Path) -> None:
    secret = "sk-live-example-do-not-leak"
    text = render_config(tmp_path, include_paid=True, local_base="http://127.0.0.1:8788/v1")
    assert "model_name: paid" in text
    assert "model_name: deepseek-flash" in text
    assert "model_name: deepseek-v4-pro" in text
    assert 'model: "openai/deepseek-flash"' in text
    assert 'model: "openai/deepseek-v4-pro"' in text
    assert "https://api.deepseek.com" in text
    assert "os.environ/DEEPSEEK_API_KEY" in text
    assert "OPENAI_API_KEY" not in text
    assert secret not in text
    fallback = text.split("fallbacks:", 1)[1]
    assert "- paid" in fallback
    assert "deepseek-v4-pro" not in fallback
    assert "deepseek-flash" not in fallback

    env = tmp_path / "secrets.env"
    env.write_text(f"OPENAI_API_KEY={secret}\n", encoding="utf-8")
    assert paid_key_present(env) is False
    env.write_text(f"DEEPSEEK_API_KEY={secret}\nDEEPSEEK_OFF_PEAK_ONLY=1\n", encoding="utf-8")
    assert paid_key_present(env) is True
    assert key_is_set("") is False
    assert key_is_set("changeme") is False
    root = tmp_path / "drive"
    (root / "secrets").mkdir(parents=True)
    (root / "secrets" / ".env").write_text("DEEPSEEK_OFF_PEAK_ONLY=1\n", encoding="utf-8")
    assert deepseek_off_peak_only(root) is True


def test_llama_flags_and_slot_body(tmp_path: Path) -> None:
    text = flags(tmp_path)
    assert "--cache-prompt" in text
    assert "--cache-reuse 256" in text
    assert f"--slot-save-path {tmp_path / 'cache' / 'llama-slots'}" in text
    path, body = slot_request("save", 0, "preyas")
    assert path == "/slots/0?action=save"
    assert body == {"filename": "preyas.bin"}
