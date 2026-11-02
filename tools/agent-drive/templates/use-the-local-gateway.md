# Use the local gateway

When: you are about to call a model.

Do:

- POST `http://127.0.0.1:4000/v1/chat/completions` with `"model": "local"`.
- Repeat an unchanged prompt instead of rewording it, so the disk cache can hit.
- Pass `"metadata": {"session_id": "<id from new_session.py>"}` when you have a session.
- Leave `prompts/deepseek-prefix.txt` unchanged. The gateway puts that text first on DeepSeek calls so the server-side prefix cache can hit. Put variable text after it.

Skip: DeepSeek. `local` never falls back to a paid model. Ask for `auto` instead when a single retry on `deepseek-flash` is acceptable if the local server errors or runs past 60 s; that fallback is logged as `event: "fallback"` in `logs/gateway.jsonl`. For a harder task ask for `deepseek-v4-pro` explicitly; it is never automatic.
