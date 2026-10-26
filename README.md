# AI-Handwriting

Neural network classifier (CNN variant) trained with backpropagation.

---

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
```
