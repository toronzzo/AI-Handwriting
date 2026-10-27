# Bakugan Buddy — Architecture (v2)

## Stack choice: **Expo (React Native) + Skia** — not Flutter

| | Expo + Skia | Flutter |
|---|---|---|
| Body port | Canvas/`body.html` math → TypeScript + `@shopify/react-native-skia` | Full rewrite in Dart |
| Offline AI | `llama.rn`, whisper.cpp / sherpa bridges, ONNX runtimes in RN ecosystem | Possible but different glue |
| Character packs | Shared JSON/TS with web `companion/` and `body.html` | Duplicate models |
| Ship path | Android Expo dev build first; EAS | Strong UI, slower shared-code story for us |

**Decision:** Expo Dev Client, Android first. Body render stays off the JS AI path (UI/Skia frame callback). AI pipeline (M2+) on native threads / worklets.

## Repo structure

```
bakugan-buddy/
  body.html                 # canonical browser body (also /workspace/body.html)
  apps/mobile/              # Expo app (M1+)
  packages/
    body-core/              # shared motion + mood parser (TS)
    character-packs/        # JSON packs (swappable for legal)
      examples/             # few-shot / eval lines per character
  docs/
    ARCHITECTURE.md
    LICENSES.md
    MILESTONES.md
    PREYAS_FROM_ANIME.md    # anime realism: mind + body + voice
    CURSOR_PRODUCT_PROMPT.md
    RECORDING_SCRIPT.md     # (M4) mood recording lines
```

**Realism:** every body / character / voice change must pass the fake-test in `PREYAS_FROM_ANIME.md` §6. Emotion = body language + acted voice — never a cartoon face on the sphere.

## Runtime split

```
┌─────────────────────────────────────────────┐
│ UI thread / Skia                            │
│  BodyView: setEmotion / setTalking / theme  │
│  locked ~60 fps, never awaits LLM           │
└─────────────────────────────────────────────┘
          ▲ mood tags, talk volume
┌─────────────────────────────────────────────┐
│ AI worker (M2+)                             │
│  mic → VAD → STT → LLM → [mood] parse       │
│       → sentence chunk → TTS → audio        │
│  state machine: idle→listen→think→speak     │
└─────────────────────────────────────────────┘
          ▲
┌─────────────────────────────────────────────┐
│ SQLite: memory, reminders, settings         │
│ Models: on-device GGUF + voice packs         │
│ Optional Home Studio: LAN only              │
└─────────────────────────────────────────────┘
```

## M1 scope (this milestone)

- Ship `body.html` with public hooks + FPS HUD.
- Expo app hosts the same body (WebView of `body.html` for pixel-identical M1; Skia port module scaffolded).
- Debug overlay: fps, drop estimate, emotion, talk, setEmotion latency.
- Benchmark screen writes a local JSONL log (AsyncStorage / file).

## Honesty on targets

| Target | On this cloud VM | On your flagship phone |
|---|---|---|
| 60 fps body | Verified in Chromium for `body.html` | Must re-measure on device |
| <300 ms body reaction | `setEmotion` is sync (~0–1 ms) | Still measure after VAD end |
| LLM / TTS latency | Not in M1 | M3–M4 |

Cold start & battery are **out of M1** until models ship.

## Home Studio (PC sidecar, web lab)

Optional loopback process under `bakugan-buddy/studio/` (binds `127.0.0.1:8787`):

- `POST /v1/chat` — NDJSON token stream from `llama-server`
- `POST /v1/tts` — Piper (mood → length/pitch) or espeak fallback
- `WS /v1/stt` — sherpa-onnx streaming Zipformer

The `companion/` Vite app proxies `/studio`. If the sidecar is down, `brain.ts` uses the offline regex fallback — body animation never waits on the AI path.


## Emotion persistence

`packages/emotion-state` stores mood + intensity + partner memory in SQLite (Expo) / SQLite-shaped durable row (web). On load, `decayEmotion` softens intensity toward **neutral** so a days-old `[angry]` does not snap the body awake furious. Writes happen after turns — never inside the animation frame.
