# AI-Handwriting

Neural network classifier (CNN variant) trained with backpropagation.

---

<<<<<<< HEAD
## Bakugan Buddy (product)

Offline pocket companion — see [`bakugan-buddy/`](./bakugan-buddy). **M1 = body @ 60fps.**

| Path | What |
| --- | --- |
| [`bakugan-buddy/`](./bakugan-buddy) | Product app (Expo) + `body.html` + docs |
| [`body.html`](./body.html) | Canonical body runtime (hooks + FPS HUD) |
| [`companion/`](./companion) | Earlier web lab (neurons / training) |
| [`bakugan/`](./bakugan) | Agent SDK playground partner |

```bash
# M1 body in browser
python3 -m http.server 8765 --directory bakugan-buddy
# → http://127.0.0.1:8765/body.html

# Expo app
cd bakugan-buddy/apps/mobile && npm install && npx expo start
=======
## Live Bakugan (web-first) — Preyas

**Preyas** (Aquos) is the default: a ball that acts with hops, wobbles, pops, and eye glow — no cartoon face.
Also switchable: Pyrax (Pyrus), Vexar (Darkus).

| Path | What |
| --- | --- |
| [`companion/`](./companion) | Live web companion (motion ball + mic + voices) |
| [`bakugan/`](./bakugan) | Agent SDK partner for Cursor playground / hosting |

```bash
# Live web companion
cd companion && npm install && npm run dev

# LLM Bakugan (needs Cursor login)
cd bakugan && npm install && npx @grok/agent-sdk login && npx @grok/agent-sdk serve --dir . --mode single --dev
>>>>>>> origin/main
```
