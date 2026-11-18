# Voice coach

Coach steps can be read aloud with Preyas's own voice, and you can answer by
holding a button and talking instead of typing.

## Read steps aloud

In the coach popover (the "Coach" chip in the chat header) there is a switch
**"Read steps aloud"** — default OFF, remembered in localStorage under
`preyas.coach.voice`. While the coach is active and the switch is on, the
panel polls `GET /v1/coach/state` every 2 s and speaks each new coach message
once (`lastSpeak.id` changes). A new message stops the previous audio.

What is spoken comes from `speakableStep` on the brain:

- `Command:` lines and anything in backticks are never spoken;
- URLs become "the link on screen", `<n>` placeholders become "the number";
- at most 3 sentences and 420 characters (cut at a sentence end);
- Russian when more than 30% of the letters are Cyrillic (the right Piper
  voice is picked automatically).

If `GET /v1/speech` says TTS is off, the panel shows "Voice works on the
Mac; you can type." and never speaks.

## Hold to talk

Press **"Hold to talk"** to record, release to transcribe (Whisper). Clips
that are too short or hallucinated are dropped with a calm note. The
transcript appears in the panel with **Send** and **Again** buttons.

A transcript is checked against `POST /v1/coach/voice-intent`: the exact,
normalised words `done, ok, next, back, why, where am i, stop` (and Russian
`готово, дальше, назад, почему, где я, стоп`) send at once — everything else
waits for the **Send** tap. **Nothing is ever sent by voice without a
transcript you could see, except those autoSend words.** On a Danger step,
only `why` and `back` auto-send.

The coach's reply to a voice turn is shown in the panel (and spoken when the
switch is on).

## Known limits (this version)

- **Voice turns are not shown in the chat transcript** — the reply appears
  only in the coach popover. Wiring voice into the chat thread needs
  ChatScreen, which belongs to a later UI slice.
- The chat's hands-free voice session is unchanged: it may also hear the same
  words while you hold the button. Type if that gets in the way.
- Microphone permission is asked by the browser/OS on first use; a denial
  shows one calm line and typing keeps working. The microphone stream is
  released when the popover closes.
