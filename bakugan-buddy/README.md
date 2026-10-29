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

- **Room** tab — Preyas in ball form, alive: idle roll, follow, explore, sleep, mood body language, delayed notice, memory log, barks  
- **Body** tab — Aquos ball + mood buttons + in-body FPS HUD  
- **Benchmark** tab — runs mood suite, logs JSONL to AsyncStorage  

Sync body into the app after edits:

```bash
node bakugan-buddy/scripts/sync-body.mjs
```

### On a real phone (required for product metrics)

Use Expo Dev Build / `npx expo run:android`. Expo Go may load WebView HTML; native Skia port is next.

## Mood vocabulary

Single source of truth: [`packages/mood`](./packages/mood) — `neutral | happy | excited | angry | sad | surprised | thinking | listening | battle` (plus `amused` → happy). Legacy tags (`fierce`, `calm`, `curious`, …) normalize automatically. Streaming parser strips `<think>…</think>` so it is never spoken; mood fires as soon as `]` arrives.

## Characters

Start pack: `packages/character-packs/ripple.json` (**original** Aquos joker for public-safe releases).  
Private Bakugan-inspired skins stay in a private pack folder — never ship Spin Master IP publicly.

**Feels real?** Read [`docs/PREYAS_FROM_ANIME.md`](./docs/PREYAS_FROM_ANIME.md) — anime body language, partner mind, and acted voice rules. Product spine: [`docs/CURSOR_PRODUCT_PROMPT.md`](./docs/CURSOR_PRODUCT_PROMPT.md).

## Preyas brain (M1 Pro, external drive)

The room's language model runs on the Mac, not in the render loop. Setup and RAM notes: [`brain-server/README.md`](./brain-server/README.md).

```bash
cd bakugan-buddy/brain-server
./setup.sh    # once, with the external drive mounted
./start.sh    # each session. Prints http://<mac-ip>:8788
```

On the phone or in Expo web, paste that URL into the brain field (or tap **find** on the same Wi-Fi). With the server off, Preyas stays on his bark lines.

Default model is an abliterated Qwen3 8B Q4_K_M, context 4096, sized for 16 GB unified memory. `fast` is a 4B. `large` is a 14B Q4 that swaps and asks you to confirm. Weights are downloaded to `/Volumes/<Drive>/BakuganBuddy` and are not in git.

The on-device 1.7B (`llama.rn`) is off in Expo Go. A dev client turns it on with `EXPO_PUBLIC_ON_DEVICE_BRAIN=1` after `npx expo install llama.rn`, and the GGUF downloads on first use. iOS: `npx expo run:ios`. Android: `npx expo run:android`.

## Home Studio v0 (offline LLM / STT / TTS)

```bash
cd bakugan-buddy/studio
npm install
bash download-models.sh          # Piper + sherpa (skip 2GB GGUF)
npm start                        # 127.0.0.1:8787
```

LLM: run `llama-server` on port 8080. Companion web app proxies `/studio`.  
If the sidecar is off, the companion falls back to the regex brain and still runs at 60 fps.

## Concepts

- Interactive SVG model: [`docs/concepts/`](./docs/concepts/)
- **Blender AI rig** (every part movable + mood→intent driver): [`blender/`](./blender/)

```bash
python3 -m http.server 8765 --directory bakugan-buddy/docs/concepts
# → http://127.0.0.1:8765/ripple-2d-model.html

# Blender (set BLENDER to your 4.x binary)
./bakugan-buddy/blender/run.sh build
./bakugan-buddy/blender/run.sh drive --react "[excited] Let's make a splash!" --render
```

## Milestones

See `docs/MILESTONES.md`. M1 body; studio sidecar is the PC half of M2–M4.

## CI

GitHub Actions (`.github/workflows/ci.yml`) runs on every PR:

- character pack JSON schema (`scripts/validate-packs.mjs`)
- `@bakugan-buddy/mood` + `body-core` + `alive` unit tests (`node --test`, non-zero exit on failure)
- companion lint / typecheck / unit tests / production build
- studio `node --check` syntax

Local mirror: `npm run ci` from the repo root (after `npm install` in `companion/`).

## Evals

```bash
bash bakugan-buddy/evals/ci-smoke.sh   # 5 cases vs mocked llama
# full set (needs studio + llama or mock):
#   node bakugan-buddy/evals/mock-llama.mjs &
#   cd bakugan-buddy/studio && npm start &
#   cd bakugan-buddy/evals && npm run eval
```
