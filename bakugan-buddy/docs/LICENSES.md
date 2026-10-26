# Models & libraries — license checklist

Use only what matches personal / eventual Play Store distribution. **Re-verify** before public release.

## App & render

| Package | Role | License | Notes |
|---|---|---|---|
| React Native / Expo | App shell | MIT | Expo ToS for EAS |
| `@shopify/react-native-skia` | Body GPU canvas | MIT | M1+ |
| `react-native-webview` | Host `body.html` in M1 | MIT | Fallback path |
| `expo-sqlite` | Memory (M5) | MIT | |
| TypeScript | Tooling | Apache-2.0 | |

## On-device AI (M2–M4)

| Component | Role | License | Notes |
|---|---|---|---|
| llama.cpp / llama.rn | LLM runtime | MIT | |
| Qwen2.5-3B-Instruct GGUF Q4 | Candidate LLM | Tongyi Qianwen / Apache-2.0 (check card) | Benchmark vs Llama-3.2-3B / Gemma-2-2B |
| Llama-3.2-3B-Instruct | Candidate | Llama Community License | Distribution limits — read carefully |
| Gemma-2-2B-IT | Candidate | Gemma Terms | Google terms |
| sherpa-onnx Zipformer | Streaming STT | Apache-2.0 | Prefer for streaming |
| whisper.cpp | STT alt | MIT | |
| Piper / VITS (ONNX) | Tier-1 TTS | MIT (Piper) | Per-mood fine-tunes you train |
| ONNX Runtime Mobile | Voice packs | MIT | |

## Home Studio v0 (`bakugan-buddy/studio`)

| Component | Role | License | Notes |
|---|---|---|---|
| llama.cpp `llama-server` | Local LLM HTTP | MIT | Loopback only |
| Qwen2.5-3B-Instruct GGUF Q4 | Chat model | Apache-2.0 | Optional download (`download-models.sh --llm`) |
| sherpa-onnx Zipformer EN | Streaming STT | Apache-2.0 | `WS /v1/stt` |
| Piper | Tier-1 TTS | MIT | One voice setting per mood (`voices.json`) |
| Kokoro | Alt TTS | Apache-2.0 (check) | Same `/v1/tts` if `KOKORO_CMD` set |
| espeak-ng | TTS fallback | GPL-3.0 | Dev fallback only, not ship voice |

## Home Studio (M6 expressive)

| Component | Role | License | Notes |
|---|---|---|---|
| Chatterbox / F5-TTS / CosyVoice2 | Expressive TTS | Check each (often Apache-2.0 / MIT) | Reference-clip acting; no show-voice clones for public |

## Content / legal

- **Bakugan** names, designs, and show voices: © Spin Master / Sega. Personal fan build: inspired OK. **Public release: original packs only** unless licensed.
- Character content lives in `packages/character-packs/` so swapping is one folder.
- Do **not** ship cloned voices from the anime.

## One-time model download

- HTTPS download of GGUF/ONNX into app storage with checksum + resume.
- No telemetry / no cloud inference in default mode.
