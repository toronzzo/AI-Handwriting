# llama.cpp prompt cache on the drive

llama-server can reuse a shared prompt prefix and can save a slot's KV cache to disk. That keeps a long system prompt from being prefilled again after a restart.

This toolkit does not modify `bakugan-buddy/brain-server`. On branch `cursor/preyas-alive-behavior-c374`, that tree already does two different things:

| Process | Address | What it is |
| --- | --- | --- |
| brain proxy | `http://127.0.0.1:8788/v1` | OpenAI chat the gateway calls as model `local` |
| llama-server | `http://127.0.0.1:8790` | The model process. Slot save/restore lives here |

The brain proxy forwards `/v1/chat/completions` only. `POST /slots/0?action=save` against port 8788 will 404. Point `LLAMA_SERVER_URL` at llama-server (default `http://127.0.0.1:8790`).

## Flags

`./llama/cache.sh flags` prints:

```text
--cache-prompt --cache-reuse 256 --slot-save-path $AGENT_DRIVE_ROOT/cache/llama-slots
```

- `--cache-prompt` is on by default. It keeps the prefix cache for the life of the process.
- `--cache-reuse 256` reuses a shared prefix in chunks of at least 256 tokens, by shifting the KV cache, when a later request starts with the same tokens.
- `--slot-save-path` is the directory llama-server writes slot files into. setup.sh creates `$AGENT_DRIVE_ROOT/cache/llama-slots`.

brain-server's `start.sh` does not pass these flags. To use them, start llama-server yourself with the printed flags (and your GGUF), or add the flags locally without committing that change. Weights stay on the drive and out of git.

## Save and restore

With llama-server running and `--slot-save-path` set:

```bash
./llama/cache.sh save --slot 0 --name preyas
./llama/cache.sh restore --slot 0 --name preyas
```

That is `POST /slots/0?action=save` with `{"filename":"preyas.bin"}`. The file is created inside the slot directory. Names are limited to letters, numbers, `.`, `_`, and `-`.

Restore loads that file back into the slot so the next completion can continue from the saved prefix. Save after the warm system prompt has been prefilled; restore before the next session that uses the same prompt.

The slot directory is on the external drive. If the drive is unplugged the script stops, same as the rest of the toolkit.
