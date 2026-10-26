# Milestones

| ID | Deliverable you can run | Status |
|---|---|---|
| **M1** | Body @ ~60 fps in app + debug/benchmark | **In progress** |
| **M2–M4 PC** | Studio sidecar: llama.cpp + sherpa + Piper | **Web lab** |
| M2 | Phone voice I/O + barge-in + state machine | |
| M3 | On-device LLM in character | |
| M4 | Mood-voice Tier 1 + reaction bank | |
| M5 | Memory, reminders, quiz, English, hype | |
| M6 | Home Studio (LAN PC) | |
| M7 | Polish, tests, beta APK | |

## M1 acceptance

1. Open `body.html` or Expo app body screen.
2. Tap moods — body reacts without hitch.
3. HUD shows fps ≈ 60, `setEmotion` reaction ≪ 1 ms (body path).
4. Benchmark button appends a line to local metrics log.
5. `react("[excited] …")` pops open + sets mood.
6. **Anime fake-test (mute):** a friend guesses ≥7/9 moods from motion alone (`docs/PREYAS_FROM_ANIME.md` §6).

## M2–M4 PC (web lab) acceptance

1. `cd bakugan-buddy/studio && npm start` — `GET /v1/health` lists llm/stt/tts. Missing GGUF is OK (`llm.ready=false`).
2. Companion `npm run dev` — type a line. Neural **FEEL** lights `[mood]` before first sentence audio (mock if llama is down).
3. Mic: partials while talking; final fires a turn (needs sherpa models).
4. Interrupt mid-sentence: Web Audio source stops; console logs `[speech] barge-in … ms`.
5. Joke vs sad: different Piper `lengthScale` / voice (or espeak rate/pitch fallback).
6. Kill sidecar: in-character "core's offline" toast; ball still 60 fps.

## Train-the-mind coach (web lab)

1. Wake Preyas — next drill is named (or "tell me your name").
2. Tap **Try this** / a drill in the panel — composer fills or a turn fires.
3. Finish a drill — unlock toast + a spoken coach line pointing at the next one.
4. Type `what's next` / `train me` — he recites the current drill.
5. After ~28s idle — one quiet nudge, then he stays quiet.
6. Chassis spec appears once stage 5 unlocks (`real body` / Bond 60).
