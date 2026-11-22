# Windows helper (optional)

Preyas stays on the Mac. A Windows laptop on the same network can take three
jobs the Mac does not have to do itself:

| Job | What runs on the laptop | Default port |
| --- | --- | --- |
| Hearing | whisper.cpp server | 8178 |
| Backup brain | llama.cpp, Qwen3.5-4B | 8790 |
| Embeddings | llama.cpp, Qwen3-Embedding-0.6B (1024-d) | 8792 |

All three are optional. With the variables unset, speech, chat, and everything
else behave exactly as they do today: the Mac's whisper CLI, the Mac's
llama-server, and no embeddings client.

## brain.env

`scripts/preyas.sh` reads `bakugan-buddy/brain-server/brain.env` when it starts
the brain, if that file exists. A missing file is normal and is not an error.
The file is gitignored. Copy the commented block from `brain.env.example`.

```sh
# LAN address of the Windows laptop.
WHISPER_URL=http://192.168.31.88:8178
LLAMA_FALLBACK_URL=http://192.168.31.88:8790
EMBEDDINGS_URL=http://192.168.31.88:8792/v1/embeddings
```

A Tailscale address works in place of the LAN IP: a `100.x.x.x` address, or a
`*.ts.net` name, in any of the three URLs.

`LLAMA_URL` is not taken from this file. The brain process always talks to the
Mac's own llama-server at `http://127.0.0.1:8790`. The laptop is only the
backup.

## What each variable does

**WHISPER_URL.** The mic tries the whisper.cpp server first (`POST /inference`).
The connection is given about three seconds. If the laptop is asleep or the
server does not answer, Preyas falls through to the local whisper CLI, the
same path as when the variable is unset. A successful transcription is not cut
off by that three-second budget; the budget is only for the handshake.

**LLAMA_FALLBACK_URL.** Chat still goes to the Mac first. The brain caches a
`GET /health` on the local llama for 10 seconds, so it is not probed on every
turn. When that health check is down, or the chat request fails before any
bytes reach the app, the same request is tried **once** on the fallback.
A sleeping laptop is abandoned after the same three-second handshake. The
reply is marked as the backup brain:

- response header `X-Preyas-Brain: backup`
- the chat label reads "Preyas · backup brain"
- the brain log detail is `backup brain`

Paid chat (the gateway) never uses this fallback.

**EMBEDDINGS_URL.** An OpenAI-compatible `POST /v1/embeddings` client
(`embedTexts` / `embedText` in `brain-server/lib/embeddings.mjs`). If the
variable is unset, or the server cannot be reached, the client returns
`null`. It does not throw. Memory search is unchanged; this only exposes the
client.

## Status

```sh
scripts/preyas.sh status
scripts/preyas.sh status --json
```

Under the five services, status prints one line per helper: `up`, `down`, or
`unset`, and the URL when one is set. The JSON adds a `helpers` array with
`name`, `label`, `state`, and `url`. Unset helpers are not contacted.
