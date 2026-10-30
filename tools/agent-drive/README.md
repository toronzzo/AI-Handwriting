# agent-drive

A small toolkit that turns an external drive into a local-first AI workspace. Caches, the LiteLLM disk cache, chat history, skills, and notes live on the drive. If the drive is unplugged, setup and the gateway stop with a clear message and write nothing to the internal disk.

Built for a MacBook Pro M1 Pro (16 GB) with the drive mounted at `/Volumes/Agent` and the workspace at `/Volumes/Agent/agent`. Plain Python and shell. The virtualenv is on the drive. No Docker, no model weights in git.

The chat gateway sends model `local` to the OpenAI-compatible API that [bakugan-buddy/brain-server](../../bakugan-buddy/brain-server/README.md) already publishes on `http://127.0.0.1:8788/v1` (branch `cursor/preyas-alive-behavior-c374`). This toolkit does not modify that branch.

## Commands on the Mac

Plug in the drive so `/Volumes/Agent` is mounted, then:

```bash
cd tools/agent-drive
./setup.sh
```

Open a new terminal (or `source ~/.zshrc`). The cache variables are set only when `/Volumes/Agent/agent` exists and is writable.

Start the brain the way that repo already documents (unchanged):

```bash
cd bakugan-buddy/brain-server
./start.sh
```

That serves chat at `http://127.0.0.1:8788/v1`. llama-server itself stays on `http://127.0.0.1:8790`.

In another terminal, start the gateway:

```bash
cd tools/agent-drive
./gateway/start.sh
```

The gateway listens on `http://127.0.0.1:4000/v1` only (not the LAN). It has no master key, so a local client does not need a bearer token. Ask for model `local`. A second identical request is an exact-match disk-cache hit under `/Volumes/Agent/agent/cache/litellm`.

```bash
curl http://127.0.0.1:4000/v1/chat/completions \
  -H 'Content-Type: application/json' \
  -d '{"model":"local","messages":[{"role":"user","content":"hello"}],"metadata":{"session_id":"ses_demo"}}'
```

Starter context for a new session (last 3 summaries plus `skills/INDEX.md`):

```bash
./bin/new_session.sh
```

After a session, summarize it with the local model through the gateway:

```bash
./bin/summarize.sh --session ses_demo
```

Clone repos you want the rules in under `/Volumes/Agent/agent/repos/<name>`, then:

```bash
./install-rules.sh
```

DeepSeek peak status, or wait until off-peak (01:00–04:00 and 06:00–10:00 UTC, Monday–Friday are 2x) and then run a batch command:

```bash
./bin/offpeak.sh
./bin/offpeak.sh --wait -- curl http://127.0.0.1:4000/v1/chat/completions \
  -H 'Content-Type: application/json' \
  -d '{"model":"deepseek-flash","messages":[{"role":"user","content":"batch"}]}'
```

llama.cpp prefix reuse and slot files (does not restart or edit brain-server):

```bash
./llama/cache.sh flags
LLAMA_SERVER_URL=http://127.0.0.1:8790 ./llama/cache.sh save --slot 0 --name preyas
LLAMA_SERVER_URL=http://127.0.0.1:8790 ./llama/cache.sh restore --slot 0 --name preyas
```

Override the workspace with `AGENT_DRIVE_ROOT` if the drive is not named `Agent`. Example: `AGENT_DRIVE_ROOT=/Volumes/Other/agent ./setup.sh`.

## What lands on the drive

| Path | Contents |
| --- | --- |
| `skills/INDEX.md` | Recipes to read before a task, and to update after one |
| `notes/plans/` | Short plans (goal, done-when, essential steps only) |
| `prompts/deepseek-prefix.txt` | Fixed system text prepended to DeepSeek calls. Do not rewrite it per task |
| `cache/huggingface`, `pip`, `torch`, `xdg`, `uv` | Tool caches from the `~/.zshrc` block |
| `cache/litellm` | LiteLLM exact-match disk cache |
| `cache/llama-slots` | llama-server slot files (`--slot-save-path`) |
| `history/history.db` | Sessions, messages, summaries |
| `logs/gateway.jsonl` | One JSON object per logged request |
| `logs/litellm.jsonl` | Proxy process log (`json_logs: true`) |
| `secrets/.env` | Optional `DEEPSEEK_API_KEY` and `DEEPSEEK_OFF_PEAK_ONLY`, mode `600`, gitignored |
| `venv/` | CPython virtualenv with LiteLLM |
| `repos/` | Checkouts that receive untracked local rules |

`~/.zshrc` gets one marked block (`# >>> agent-drive >>>`). Running `./setup.sh` again replaces that block instead of appending a second copy. When the drive is unplugged the block does not export `HF_HOME`, `PIP_CACHE_DIR`, `TORCH_HOME`, `XDG_CACHE_HOME`, or `UV_CACHE_DIR`.

## Gateway

`gateway/start.sh` writes a config on the drive (not in git) and runs LiteLLM on port 4000, bound to `127.0.0.1`, one worker.

- `local` → `openai/local` at `AGENT_DRIVE_LOCAL_API_BASE` (default `http://127.0.0.1:8788/v1`) with a dummy key, so it does not use a paid credential. This is the route to ask for.
- `paid` → DeepSeek `deepseek-flash` (DeepSeek-V4.1-Flash-1017) at `https://api.deepseek.com`, and only as the fallback when `local` fails. It is added only when `secrets/.env` contains `DEEPSEEK_API_KEY`. The config stores `os.environ/DEEPSEEK_API_KEY`, not the key.
- `deepseek-flash` is the same upstream model, for an explicit request. `deepseek-v4-pro` (DeepSeek-V4-Pro-0813) is for a harder task and is never the automatic fallback.
- On the way to DeepSeek the gateway puts `prompts/deepseek-prefix.txt` in front of the messages and does not add a timestamp. Keep that file stable so DeepSeek's server-side context cache hits. A cache-hit input token is 50× cheaper than a cache miss ($0.003 vs $0.15 per 1M tokens, off-peak). Variable text goes after the prefix.
- `DEEPSEEK_OFF_PEAK_ONLY=1` refuses DeepSeek calls during weekday peak (01:00–04:00 and 06:00–10:00 UTC, 2× the off-peak price) and tells you when off-peak starts. `./bin/offpeak.sh --wait` sleeps until then for batch jobs. Weekends are off-peak. DeepSeek also bills Chinese public holidays as off-peak; this estimate uses the weekday clock only.
- Disk cache: `cache_params.type: disk` at `$AGENT_DRIVE_ROOT/cache/litellm` (the local exact-match cache, separate from DeepSeek's server cache).
- Callback `agent_drive.callback.proxy_handler_instance` appends every success, including cache hits, to `history/history.db` and `logs/gateway.jsonl`, with prompt tokens, cache-hit and cache-miss tokens, the peak/off-peak window, and `estimated_cost_usd`.

Pass a session id as `metadata.session_id` or the `X-Agent-Session` header. `./bin/new_session.sh` prints an id.

To stay local-only, leave `DEEPSEEK_API_KEY` commented out. A placeholder such as `changeme` is treated as unset. An `OPENAI_API_KEY` does not turn the fallback on.

Prices are the public DeepSeek list from [Models & Pricing](https://api-docs.deepseek.com/quick_start/pricing/) (checked 2026-10-29). Flash off-peak is $0.003 / $0.15 / $0.60 per 1M cache-hit input, cache-miss input, and output tokens. Pro off-peak is $0.022 / $0.66 / $1.98. Peak is 2×. There is no cache-write fee.

## History

SQLite tables: `sessions`, `messages`, `summaries`. Each message row stores `prompt_tokens`, `completion_tokens`, `prompt_cache_hit_tokens`, `prompt_cache_miss_tokens`, `rate_window` (`peak` or `off-peak`), and `estimated_cost_usd`. Local calls are `0`.

`./bin/summarize.sh` sends the recent transcript to model `local` on the gateway (override with `--base-url` or `AGENT_DRIVE_SUMMARY_API_BASE`) and stores the reply as a summary. `./bin/new_session.sh` prints the three newest summaries and the skills index as a compact starter.

## Rules

`install-rules.sh` copies `templates/AGENTS.md` and `templates/agent-drive.mdc` into each git repo under `$AGENT_DRIVE_ROOT/repos/`. The Cursor rule is `alwaysApply: true`. Both paths are added to that repo's `.git/info/exclude`, so they stay untracked. A file that is already tracked is left alone. Running the script again refreshes the untracked copies.

The rules tell an agent to read `skills/INDEX.md` and `notes/` first, check `cache/` and `history/` for an earlier result, write a short plan for a big task, use compact prompts, and then save a skill plus an index row.

## llama.cpp cache

See [docs/llama-cache.md](docs/llama-cache.md). Short version: `--cache-prompt` (default on), `--cache-reuse 256`, and `--slot-save-path` on the drive. Slot save/restore is `POST /slots/{id}?action=save|restore` on llama-server (port 8790 in brain-server), not on the port 8788 chat proxy.

## Develop and test

CI runs on Linux with no GPU. Tests use a fake OpenAI-compatible server.

```bash
cd tools/agent-drive
python3 -m venv /tmp/agent-drive-dev
/tmp/agent-drive-dev/bin/pip install -r requirements.txt -r requirements-dev.txt
/tmp/agent-drive-dev/bin/python -m pytest
```

`AGENT_DRIVE_ALLOW_INTERNAL=1` lets the mount check use a normal directory. That is for Linux CI, not for the Mac. `AGENT_DRIVE_SKIP_VENV=1` skips the LiteLLM install when you only want to re-check folders and the zshrc block.

Nothing in this tree downloads GGUF or other weights. Do not commit `secrets/.env`.

## License

[MIT](LICENSE). LiteLLM's core is MIT; the proxy extra pulls LiteLLM's own dependency set, which is not re-licensed here.
