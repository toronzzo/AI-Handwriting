# AI-Handwriting

Neural network classifier (CNN variant) trained with backpropagation.

---

## Bakugan Buddy (product)

Offline pocket companion — see [`bakugan-buddy/`](./bakugan-buddy). **M1 = body @ 60fps.**

| Path | What |
| --- | --- |
| [`bakugan-buddy/`](./bakugan-buddy) | Product app (Expo) + `body.html` + docs |
| [`body.html`](./body.html) | Canonical body runtime (hooks + FPS HUD) |
| [`bakugan-buddy/docs/PREYAS_FROM_ANIME.md`](./bakugan-buddy/docs/PREYAS_FROM_ANIME.md) | Anime realism — mind, body, voice |
| [`bakugan-buddy/studio/`](./bakugan-buddy/studio) | Home Studio sidecar (llama + STT + TTS, loopback) |
| [`companion/`](./companion) | Earlier web lab (neurons / training / coach) |
| [`bakugan/`](./bakugan) | Agent SDK playground partner |

```bash
# M1 body in browser
python3 -m http.server 8765 --directory bakugan-buddy
# → http://127.0.0.1:8765/body.html

# Expo app
cd bakugan-buddy/apps/mobile && npm install && npx expo start

# Web lab (optional) — falls back to regex brain if studio is off
cd companion && npm install && npm run dev

# Home Studio sidecar (optional)
cd bakugan-buddy/studio && npm install && npm start
```
