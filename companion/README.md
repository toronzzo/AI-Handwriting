# Live Bakugan — Preyas-first

Web companion where the **ball** acts with motion, and you can **see the neurons** firing inside.

## Outside
Happy hops · excited pop-open · angry shake · sad droop · talk-bob

## Inside
Live neural stack: **SENSE → FEEL → INTENT → SPEAK → BODY**  
“About to say” preview before speech · step-by-step training drills · body roadmap toward a future real chassis

```bash
cd companion
npm install
npm run dev
```

Offline brain (llama.cpp Qwen2.5-3B), ears (sherpa-onnx), voice (Piper per mood):

```bash
cd ../bakugan-buddy/studio && npm install && npm start
# optional: llama-server -m models/qwen2.5-3b-instruct-q4_k_m.gguf --port 8080
```

Vite proxies `/studio` → `127.0.0.1:8787`. If the sidecar is down, the ball still runs on the local mock core.

Try: `I'm Alex` → `pop open` → `I feel sad` → `remember I like tides` → `real body`
