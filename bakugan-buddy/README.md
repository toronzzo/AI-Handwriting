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

**Feels real?** Read [`docs/PREYAS_FROM_ANIME.md`](./docs/PREYAS_FROM_ANIME.md) — anime body language, partner mind, and acted voice rules. Product spine: [`docs/CURSOR_PRODUCT_PROMPT.md`](./docs/CURSOR_PRODUCT_PROMPT.md).

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

See `docs/MILESTONES.md`. Next: **M2** voice I/O + barge-in.
