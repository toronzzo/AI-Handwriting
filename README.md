# AI-Handwriting

Neural network classifier (CNN variant) trained with backpropagation.

---

## Live Bakugan (web-first)

Talk with **Pyrax** (Pyrus), **Namiq** (Aquos), or **Vexar** (Darkus).
Face runs at 60fps separately from the brain; mood tags fire first; speech is sentence-streamed.

| Path | What |
| --- | --- |
| [`companion/`](./companion) | Live web companion (face + mic + voices) |
| [`bakugan/`](./bakugan) | Agent SDK Pyrax for Cursor playground / hosting |

```bash
# Live web companion
cd companion && npm install && npm run dev

# LLM Bakugan (needs Cursor login)
cd bakugan && npm install && npx @grok/agent-sdk login && npx @grok/agent-sdk serve --dir . --mode single --dev
```
