# Preyas on the screen (menu-bar helper)

A small always-on-top button, like iPhone AssistiveTouch. Tap it, Preyas takes a
picture of the screen (or a region you drag, or one of the last 10 screenshots
in `~/Pictures/Screenshots`), you type or speak a question, and the answer
sits in a bubble next to the button. Follow-ups stay on that same picture.

The helper is a native macOS app. The brain on port 8788 answers. The text
model (Qwen3 8B) cannot see pictures. A vision model does.

This Mac is an M1 Pro with 16 GB. The 8B already uses about 6.5–8 GB. Prefer
the free cloud vision route so a second model is not loaded beside it.

## Build the helper

On the Mac, from the repo:

```sh
bash bakugan-buddy/apps/preyas-helper/build.sh
open "bakugan-buddy/apps/preyas-helper/dist/Preyas Helper.app"
```

Needs macOS 14 or newer and Swift 6 (`swiftc`). The script writes
`Preyas Helper.app` and does not use Homebrew. Linux CI skips the compile
(`uname` is not Darwin) so the required GitHub job stays green.

The app is a menu-bar item (no Dock icon) plus a blue **P** button that stays
above other windows, including full-screen spaces. Drag the button to move it.
Control-Option-P hides it and shows it again. A tap captures the whole display
under the button. Tap again to close the bubble. Right-click, or the menu bar,
for **Select a region** and **Recent screenshots**.

## Permissions

The first capture asks for Screen Recording. If you refuse, the bubble says so
and offers System Settings → Privacy & Security → Screen Recording. Turn on
**Preyas Helper**, then tap again. Region selection uses the system
`screencapture` tool, so that same permission covers it.

The mic button uses on-device speech recognition. It asks for the microphone
and for speech recognition. If on-device speech is not available for your
language, the bubble says so and you type instead. Audio is not sent to the
brain.

## Pairing

Every brain route, including these, needs the paired token. The helper reads
it and sends `X-Preyas-Token`. It does not print the token.

1. Pair once in the Preyas web app (the code is on the Mac).
2. The token file is `/Volumes/Agent/BakuganBuddy/memory/local-token`.
3. Or set `PREYAS_TOKEN_PATH` to that file, and `BAKUGAN_DATA_DIR` if the
   drive is mounted somewhere else.
4. The brain defaults to `http://127.0.0.1:8788`. Override with
   `PREYAS_BRAIN_URL`. The helper only talks to this Mac or a private home
   address (`10.`, `192.168.`, `172.16`–`172.31`).

Screenshots you already took live in `~/Pictures/Screenshots`. If Cmd-Shift-5
still saves to the Desktop, change the save location there. The list is the
10 newest PNG, JPEG, WEBP, or GIF files in that folder.

## Where the picture goes

The bubble says this before you press Ask, and again with the answer.

| Route | What you see | Picture |
| --- | --- | --- |
| Groq | "will leave this Mac" / "It left this Mac." | Sent to Groq through the gateway on port 4000. |
| Gemini | Same, naming Gemini. | Sent to Gemini through that gateway. |
| Local | "will stay on this Mac" / "It stayed on this Mac." | A temp file for `llama-mtmd-cli`, deleted when the answer returns. Not sent to the gateway. |
| None | What is missing, and that the picture stayed here. | Not sent anywhere. |

Groq is preferred when both cloud models are on the gateway. **Keep this
picture on this Mac** forces the local model and is only enabled when that
model is actually ready. A cloud HTTP error does not then send the picture to
a second model. If the gateway is not reachable at all, and a local model is
ready, the local model answers and the bubble says the picture stayed here.

The brain asks the gateway not to cache the call. The gateway history log
stores `[image]`, not the picture bytes.

## Turn on a free cloud vision model

Keys stay in `$AGENT_DRIVE_ROOT/secrets/.env` (mode `600`), not in this repo.
Restart the gateway after you add one (`scripts/preyas.sh restart litellm`,
or start the gateway again). The config is rendered at start.

Groq free vision, alias `groq-vision`:

```sh
echo 'GROQ_API_KEY=gsk_...' >> "$AGENT_DRIVE_ROOT/secrets/.env"
```

`PREYAS_FREE_CLOUD_KEY` is accepted as the same key. The rendered route calls
`groq/meta-llama/llama-4-scout-17b-16e-instruct`. If Groq renames it, set
`GROQ_VISION_MODEL` to the new id (no `groq/` prefix).

Gemini free, alias `gemini-flash`:

```sh
echo 'GEMINI_API_KEY=...' >> "$AGENT_DRIVE_ROOT/secrets/.env"
```

`GOOGLE_API_KEY` works too. The default id is `gemini-2.5-flash`. Override
with `GEMINI_VISION_MODEL`.

These routes are explicit. Text chat does not fall through to them, and they
are not added to the paid fallback.

Check without sending a picture (the token is the paired one):

```sh
TOKEN="$(cat /Volumes/Agent/BakuganBuddy/memory/local-token)"
curl -sS -H "X-Preyas-Token: $TOKEN" http://127.0.0.1:8788/v1/vision
```

`leavesMac` is true only when the next answer would use Groq or Gemini.

## Local vision model (optional)

Use this when you want the picture to stay on the Mac. Pick a **small** model.
Moondream 2 or SmolVLM, about 1.5 GB or less, is the size that can sit beside
the 8B for one question. A second 8B will swap this Mac.

Put both files here:

```
/Volumes/Agent/BakuganBuddy/models/vision/<name>.gguf
/Volumes/Agent/BakuganBuddy/models/vision/<name>-mmproj.gguf
```

The filename should say what it is (`moondream`, `smolvlm`, `llava`, `vision`,
…). The text Qwen3 GGUF is ignored even if an mmproj file sits next to it.

The runner is `llama-mtmd-cli` from the same llama.cpp build as
`llama-server`. Put it next to that binary, or set `PREYAS_VISION_BIN`.
The brain runs it once per question and it exits, so the vision weights are
not left resident. During the answer, RAM is the text model plus this one.
If the Mac starts swapping, use Groq instead.

Optional overrides: `PREYAS_VISION_GGUF`, `PREYAS_VISION_MMPROJ`,
`PREYAS_VISION_DIR`. A path that points at the text Qwen3 file is refused.

## The brain routes

Both require the pairing header. There is no token in the query string.

`GET /v1/vision` reports the route that would be used. It does not take a
picture.

`POST /v1/vision/ask` JSON:

```json
{
  "question": "how do I do this in iGrafx?",
  "image": "<base64 jpeg or a data URL>",
  "mime": "image/jpeg",
  "history": [{ "role": "user", "content": "what app is this?" }],
  "prefer": "auto"
}
```

`prefer` is `auto` (Groq, then Gemini, then local), `groq`, `gemini`,
`local`, or `cloud`. The picture must be a real PNG, JPEG, WEBP, or GIF, at
most 4 MB. The helper sends a JPEG whose long edge is 1280.

The system text is Preyas's live persona (`chat-system.txt` on the drive, or
the repo default) plus one line that he is looking at a screenshot. Answers
stay in his voice.

A missing model is HTTP 503 with `error: "no_vision_model"` and a message that
names Groq, Gemini, or `llama-mtmd-cli`, and says the picture stayed on this
Mac.
