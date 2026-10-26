# Milestones

| ID | Deliverable you can run | Status |
|---|---|---|
| **M1** | Body @ ~60 fps in app + debug/benchmark | **In progress** |
| M2 | Voice in/out + barge-in + state machine | |
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
