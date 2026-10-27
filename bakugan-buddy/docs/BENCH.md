# Home Studio bench (M1 Mac)

Targets (product prompt): body reacts on mood tag **&lt; 100 ms** path; first audio **&lt; 1.0 s** aspirational on flagship; animation never waits on the AI.

## How to measure on your Mac

```bash
# 1) Models (voices always; GGUF ~2.1GB with --llm)
cd bakugan-buddy/studio
bash download-models.sh --llm

# 2) llama.cpp server (install llama.cpp / brew / build yourself)
llama-server \
  -m models/qwen2.5-3b-instruct-q4_k_m.gguf \
  --host 127.0.0.1 --port 8080 -c 4096

# 3) Studio sidecar
npm install && npm start

# 4) Bench
node scripts/bench-sidecar.mjs "Hey partner — you ready?"
```

GGUF SHA-256 (official Qwen file): `626b4a6678b86442240e33df819e00132d3ba7dddfe1cdc4fbb18e0a9615c62d`

## Results

| when (UTC) | host | first mood ms | first audio ms | full chat ms | TTS engine | LLM |
| --- | --- | --- | --- | --- | --- | --- |
<!-- BENCH_ROWS -->
| *(no local GGUF/llama-server in CI agent — run commands above on the M1)* | darwin/arm64 | — | — | — | — | no |

## Notes

- **first mood ms** — stream time until the closing `]` of the leading `[mood]` tag (body may react immediately).
- **first audio ms** — warm Piper worker, first sentence WAV ready (model kept loaded).
- **full chat ms** — entire token stream finished.
- Private persona/lore/examples: copy `characters/preyas/*.template.*` → untracked real files (gitignored).
