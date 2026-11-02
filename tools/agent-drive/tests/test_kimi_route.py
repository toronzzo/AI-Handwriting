from agent_drive.gateway_config import render_config

BASE = "http://127.0.0.1:8788/v1"


def test_kimi_absent_without_key(tmp_path):
    text = render_config(tmp_path, include_paid=True, local_base=BASE)
    assert "model_name: kimi" not in text


def test_kimi_routes_when_key_set(tmp_path):
    text = render_config(tmp_path, include_paid=True, local_base=BASE, include_kimi=True)
    assert "model_name: kimi\n" in text
    assert "model_name: kimi-low" in text
    assert "os.environ/KIMI_API_KEY" in text
    assert 'reasoning_effort: "high"' in text and 'reasoning_effort: "low"' in text


def test_kimi_is_never_a_fallback(tmp_path):
    text = render_config(tmp_path, include_paid=True, local_base=BASE, include_kimi=True)
    fallbacks = text.split("router_settings:")[1]
    assert "kimi" not in fallbacks.replace(str(tmp_path), "")
