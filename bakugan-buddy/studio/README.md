# Home Studio v0 (loopback)

Offline sidecar for the web companion: **llama.cpp** (Qwen2.5-3B) + **sherpa-onnx** STT + **Piper** (Kokoro-compatible `/v1/tts`).

Binds **127.0.0.1:8787** only. No internet at runtime.

```bash
cd bakugan-buddy/studio
npm install
bash download-models.sh          # piper voices + sherpa (skip 2GB GGUF)
# bash download-models.sh --llm  # also Qwen2.5-3B Q4
npm start
```

LLM chat needs `llama-server` on `127.0.0.1:8080`:

```bash
llama-server -m models/qwen2.5-3b-instruct-q4_k_m.gguf --host 127.0.0.1 --port 8080
```

If llama-server or Piper is missing, `GET /v1/health` reports `ready: false` and the companion falls back (mock brain / espeak / typed chat).

| Route | Job |
| --- | --- |
| `GET /v1/health` | Which engines are loaded |
| `POST /v1/chat` | NDJSON `{type:token}` stream |
| `POST /v1/tts` | `{ text, mood }` → `audio/wav` |
| `WS /v1/stt` | Int16 PCM 16 kHz |

Licenses: Qwen Apache-2.0, llama.cpp MIT, sherpa-onnx Apache-2.0, Piper MIT.
