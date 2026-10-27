# Home Studio (M1 Mac + loopback)

Offline sidecar: **llama.cpp** (Qwen2.5-3B) + **sherpa-onnx** STT + **Piper** (warm worker / pip / native binary).

Binds **127.0.0.1:8787** only. No internet at runtime.

```bash
cd bakugan-buddy/studio
npm install
bash download-models.sh          # voices + STT (uses shasum -a 256; darwin-arm64 Piper)
# bash download-models.sh --llm  # also Qwen2.5-3B-Instruct Q4_K_M (~2.1GB, checksummed)
npm start
```

### Apple Silicon TTS

`download-models.sh` on `darwin-arm64`:

1. Downloads `piper_macos_aarch64` when available, else
2. Creates `models/venv` and `pip install piper-tts`, else
3. Falls back to espeak-ng / sherpa-onnx TTS if you install them.

The studio keeps **one warm** `tts_worker.py` process and synthesizes **sentence by sentence** (`POST /v1/tts/sentences`).

### Prompt pack

System prompt = `characters/preyas/persona.json` + `lore.md` + ~8 retrieved `examples.jsonl` lines  
(templates with PLACEHOLDER text ship in-repo; real private files are gitignored).

### LLM

```bash
llama-server -m models/qwen2.5-3b-instruct-q4_k_m.gguf --host 127.0.0.1 --port 8080
```

Bench: `node scripts/bench-sidecar.mjs` → appends rows to `../docs/BENCH.md`.

| Route | Job |
| --- | --- |
| `GET /v1/health` | Engines + prompt sources |
| `POST /v1/chat` | NDJSON tokens + `timing.firstMoodMs` |
| `POST /v1/tts` | `{ text, mood }` → `audio/wav` (warm worker) |
| `POST /v1/tts/sentences` | NDJSON sentence WAVs (base64) |
| `WS /v1/stt` | Int16 PCM 16 kHz |

Licenses: Qwen Apache-2.0, llama.cpp MIT, sherpa-onnx Apache-2.0, Piper MIT.
