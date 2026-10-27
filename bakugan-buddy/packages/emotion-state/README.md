# Emotion state (SQLite + decay)

Persistent mood / bond / facts with **soft decay toward `neutral`**.

- Pure decay math: `decayEmotion()` — safe to call when hydrating; do not block the 60 fps body path on I/O.
- Schema: `EMOTION_SCHEMA` (single-row `emotion_state`).
- Adapters:
  - Companion web: `companion/src/state/emotionDb.ts` (SQLite-shaped row in `localStorage`)
  - Expo: `apps/mobile/src/state/emotionStore.ts` (`expo-sqlite`)

Half-lives: excited/surprised fade in minutes; sad lasts longer; then mood returns to neutral.
