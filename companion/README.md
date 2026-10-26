# Live Bakugan (web)

Talk with **Pyrax** (Pyrus), **Namiq** (Aquos), or **Vexar** (Darkus).

## Live loop

- Face canvas runs its own **60fps** loop (never waits on the brain)
- First token of each reply is a mood tag like `[excited]` → face + sound snap immediately
- **Mic** mode: nods / eye-widen / soft ticks while you’re still talking
- Sentences are **spoken as they arrive**; typing or a new turn barges in
- Offline **emotion one-shots** (growl, laugh, blip) per mood

## Run

```bash
cd companion
npm install
npm run dev
```

Say or type a partner name (`switch to Namiq`) to swap. Shared memory remembers you across all three.
