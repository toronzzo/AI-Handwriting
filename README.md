# AI-Handwriting

Neural network classifier (CNN variant) trained with backpropagation.

---

## Pyrax — personal Bakugan

Talk with **Pyrax**, your fire-core Bakugan partner.

| Path | What |
| --- | --- |
| [`companion/`](./companion) | Animated sphere + chat UI (open in browser) |
| [`bakugan/`](./bakugan) | Agent SDK companion for Cursor playground / hosting |

```bash
# Visual chat companion
cd companion && npm install && npm run dev

# LLM Bakugan (needs Cursor login)
cd bakugan && npm install && npx @grok/agent-sdk login && npx @grok/agent-sdk serve --dir . --mode single --dev
```
