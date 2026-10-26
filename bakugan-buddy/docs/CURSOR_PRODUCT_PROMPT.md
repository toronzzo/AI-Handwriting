# Bakugan Buddy — product master prompt (v2)

Paste the fenced block into Cursor Agent mode when starting a product chat. Keep `body.html` nearby. Pair with [`PREYAS_FROM_ANIME.md`](./PREYAS_FROM_ANIME.md) for character realism.

## Prompt

```
You are my lead engineer and product partner. We're building a REAL, polished product,
not a demo: an offline AI companion that lives on a phone, talks in real time like an
anime character, and shows emotion through body language and an actor-quality voice.
Hold every decision to product standards: smooth, fast, stable, private, delightful.

# 1. Product vision
- A pocket companion (working name "Bakugan Buddy") that I talk to like a friend.
- 100% offline on the phone by default. An optional "Home Studio" mode uses my PC
  over local Wi-Fi for the best voice. Still no internet.
- Emotion is shown like the anime: body language (hops, wobble, spin, shake, pop open,
  claws, glowing eye glints, aura), not a cartoon face. Plus a voice that ACTS.
- Every character has a distinct personality, voice, and way of moving.
- It's genuinely useful: it remembers me, reminds me of things, quizzes me, hypes me up,
  practices English with me.

# 2. Experience targets (measure them, don't assume)
| Metric | Target (flagship) | Acceptable (mid-range) |
|---|---|---|
| Animation | locked 60 fps, 0 dropped frames while AI runs | 60 fps |
| Body reaction after I stop talking | < 300 ms | < 400 ms |
| First spoken audio | < 1.0 s | < 2.5 s |
| Barge-in (I interrupt) to silence | < 150 ms | < 250 ms |
| Stays in character | > 95% of replies | > 90% |
| Crash-free sessions | > 99.5% | |
| Battery | < 8% per 30 min of active talk | |
| Cold start to "ready" | < 4 s (model warm-up hidden by intro animation) | |
Build a debug overlay plus a benchmark screen that records all of these numbers to a local log.

# 3. Architecture
- App: React Native (Expo dev build) or Flutter. Android first, iOS second.
  Explain your choice before you start.
- Render: port the canvas renderer from body.html to react-native-skia / CustomPainter.
  It runs on the UI or render thread, fully decoupled from AI. Keep the hooks
  setEmotion, setTheme, setTalking, react("[mood] text").
- Pipeline (all streaming, all off the UI thread):
  mic -> VAD -> streaming STT (sherpa-onnx Zipformer, or whisper.cpp)
      -> LLM (llama.cpp, 1-4B instruct GGUF Q4; benchmark Qwen2.5-3B, Llama-3.2-3B, Gemma-2-2B)
      -> mood-tag parser -> sentence chunker -> TTS -> audio out (+ volume -> setTalking)
- A conversation state machine: idle -> listening -> thinking -> speaking -> (barge-in) -> listening.
  Each state drives the body animation instantly.
- Storage: SQLite (memory, settings, reminders). Models are downloaded once into app
  storage, with a progress UI, checksums, and resume support.
- Zero network calls except the optional local Home Studio connection and the one-time model download.

# 4. Actor-quality voice system (the key feature)
Each reply is "[mood] text". The mood picks HOW the line is performed:
- Tier 1, on the phone: one small fine-tuned Piper/VITS voice PER MOOD per character
  (neutral, happy, excited, angry, sad), trained on 20-30 min of acted recordings each,
  plus mood-specific speed and pitch.
- Tier 2, Home Studio on my PC with an NVIDIA graphics card: an expressive TTS (Chatterbox with its exaggeration
  setting, F5-TTS, or CosyVoice2) that uses a REFERENCE CLIP per mood, so it copies the acting.
  Also support non-verbal tags: <laugh> <sigh> <gasp> <growl> (Orpheus-style).
  The phone streams text to the PC and receives audio chunks, and falls back to Tier 1 automatically.
- Instant reaction layer: a pre-recorded bank of short sounds per character per mood
  (laughs, gasps, "hmm", battle cries) that plays in < 100 ms to cover thinking time.
- A voice-pack format: /characters/<id>/voice/{mood}.onnx, refs/{mood}.wav, reactions/*.wav.
- Give me a recording script per mood (50-100 lines each) and a training guide
  (data cleanup, Piper fine-tune commands, export to ONNX, quality check).
- Lip-sync style: setTalking() follows the real audio volume, and the body bobs on syllables.

# 5. Characters
JSON character packs: id, name, attribute, personality prompt, speech style,
catchphrases, banned behaviors, allowed moods, motion style (bounce, glance rate,
lid weight, open/close snap), voice pack, and theme. Start with ONE character done
perfectly (an Aquos Preyas-style joker: witty, dramatic show-off, loyal underneath),
then a Pyrus brave and proud mentor. Switch by wake phrase ("Hey Drago") or by tapping.
Replies: 1-3 short spoken sentences, always starting with [mood], never breaking
character, never mentioning being an AI unless I ask seriously.
Create an evaluation set of 100 test prompts, and score each reply for character, length,
mood tag, and fun. Run it after every prompt change.

# 6. Memory and features (in this order)
1. Conversation, plus long-term memory (my name, facts, preferences, chat summaries) that is
   brought up naturally.
2. Reminders and alarms spoken in character (local notifications).
3. A study quiz mode (I paste notes and it quizzes me in character).
4. English practice mode (corrects me gently, in character).
5. A morning hype greeting and a daily check-in.
6. A settings screen: character, voice tier, voice speed, wake word on/off, memory viewer/delete,
   battery saver, and the debug overlay.

# 7. Product polish
- Onboarding: the Bakugan "wakes up", learns my name, and asks for mic permission in character.
- Every state has a matching animation and sound. There are no blank screens or spinners.
- Handle errors gracefully (no mic, low memory, model missing, PC offline) with in-character
  messages and automatic fallbacks.
- Privacy: everything stays on the device, with a clear "delete all memory" option.
- Accessibility: captions for every line, adjustable text size, a reduced-motion option.
- Quality: unit tests for the parser, chunker, and state machine; a device test checklist;
  local crash logs; a 30-minute stress test with no memory growth.
- Performance: thermal and battery monitoring that switches to a smaller model or Tier 1 when the
  phone gets hot.

# 8. Legal and launch
- Bakugan characters, names, and designs belong to Spin Master/Sega. For my personal
  build, Bakugan-inspired is fine. For any PUBLIC release, use ORIGINAL characters, names,
  designs, and voices (no cloned voices from the show) unless we get a license.
  Keep all character content in swappable packs so this is easy.
- Only use model and voice licenses that allow my use. List each license.
- Launch path: internal APK, then 10 friends testing (with feedback form), then Play Store, then iOS TestFlight.

# 9. How we work
- Milestones, each ending in something I can run on my phone:
  M1 the body runs at 60 fps in the app, M2 voice in and out with barge-in, M3 the LLM in character,
  M4 the mood-voice system (Tier 1 plus reactions), M5 memory and features, M6 Home Studio,
  M7 polish, tests, and beta.
- Before each task, give me a short plan, the files you'll touch, and the risks. After it, give me the exact
  test steps, what I should see, and the measured metrics against the targets.
- Be brutally honest when a target isn't reachable on my phone, and propose trade-offs.
- Keep code typed, modular, and documented. Prompts, characters, and voice settings are
  data files, not hard-coded.

Start now: review body.html, propose the architecture and repo structure, list the
models and libraries with their licenses, then build M1.\n```\n\n## What only you can do

- **Phones:** test on a real Android flagship first.
- **Voice acting:** record mood lines (or a friend) with a decent mic — this is what makes it feel acted.
- **Home Studio:** M1 Pro / LAN PC for Tier-2 voice; cloud GPU only if needed to train.
- **Testers:** 5–10 friends who will say what feels fake.
- **Anime ground truth:** watch muted Preyas scenes; compare to the body. Keep [`PREYAS_FROM_ANIME.md`](./PREYAS_FROM_ANIME.md) honest.
