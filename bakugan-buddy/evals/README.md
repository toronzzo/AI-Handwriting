# Evals

Conversation scorecard against the Home Studio sidecar.

```bash
# Terminal A — mock model (CI) or real llama-server
node bakugan-buddy/evals/mock-llama.mjs
# Terminal B
cd bakugan-buddy/studio && npm start
# Terminal C
cd bakugan-buddy/evals && npm run smoke    # 5 cases, 100% required
npm run eval                               # full 20-case set
```

Real Mac bench (GGUF):

```bash
llama-server -m ../studio/models/qwen2.5-3b-instruct-q4_k_m.gguf --host 127.0.0.1 --port 8080
cd ../studio && npm start
cd ../evals && npm run eval
```

Each case checks: expected mood (canonical + aliases), required words, banned words, max length.
