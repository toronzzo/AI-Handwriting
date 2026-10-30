# Use the local gateway

When: you are about to call a model.

Do:

- POST `http://127.0.0.1:4000/v1/chat/completions` with `"model": "local"`.
- Repeat an unchanged prompt instead of rewording it, so the disk cache can hit.
- Pass `"metadata": {"session_id": "<id from new_session.py>"}` when you have a session.
- Leave `prompts/deepseek-prefix.txt` unchanged. The gateway puts that text first on DeepSeek calls so the server-side prefix cache can hit. Put variable text after it.

Skip: DeepSeek, unless the local server is down (the gateway falls back to `deepseek-flash` on its own) or the task is explicitly `deepseek-flash` or `deepseek-v4-pro`. Do not call DeepSeek directly. `deepseek-v4-pro` is for a harder task, not the automatic fallback.
