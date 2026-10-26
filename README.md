# AI-Handwriting

Neural network classifier (CNN variant) trained with backpropagation.

---

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
```
