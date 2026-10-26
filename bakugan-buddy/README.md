# Bakugan Buddy

Offline pocket companion — **M1: body at 60 fps**.

## Stack

**Expo (React Native) + body runtime** — Android first.  
See `docs/ARCHITECTURE.md` (why not Flutter) and `docs/LICENSES.md`.

## Quick start

### Body only (browser)

```bash
# from repo root
python3 -m http.server 8765 --directory bakugan-buddy
# open http://127.0.0.1:8765/body.html
```

Hooks: `BakuganBody.setEmotion`, `setTheme`, `setTalking`, `react("[mood] text")`.

### Mobile app (Expo)

```bash
cd bakugan-buddy/apps/mobile
npm install
npx expo start
```

- **Body** tab — Aquos ball + mood buttons + in-body FPS HUD  
- **Benchmark** tab — runs mood suite, logs JSONL to AsyncStorage  

Sync body into the app after edits:

```bash
node bakugan-buddy/scripts/sync-body.mjs
```

### On a real phone (required for product metrics)

Use Expo Dev Build / `npx expo run:android`. Expo Go may load WebView HTML; native Skia port is next.

## Characters

Start pack: `packages/character-packs/ripple.json` (**original** Aquos joker for public-safe releases).  
Private Bakugan-inspired skins stay in a private pack folder — never ship Spin Master IP publicly.

## Home Studio v0 (offline LLM / STT / TTS)

```bash
cd bakugan-buddy/studio
npm install
bash download-models.sh          # Piper + sherpa (skip 2GB GGUF)
npm start                        # 127.0.0.1:8787
```

LLM: run `llama-server` on port 8080. Companion web app proxies `/studio`.

## Milestones

See `docs/MILESTONES.md`. M1 body; studio sidecar is the PC half of M2–M4.
