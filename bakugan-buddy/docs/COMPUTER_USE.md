# Computer use (B6): ask-first clicks and keys

Preyas can now PROPOSE a click, a key press or some typing on the Mac. He never
does anything by himself: every single action shows a Да/Нет card first, and
you can press Stop at any moment. The feature is OFF until you switch it on.

## What it is

- You write a small goal (for example "type hello in TextEdit"), then press
  **Next step**.
- Preyas reads a TEXT summary of the frontmost window — element id, role,
  label and position from the macOS accessibility tree — and proposes ONE
  next step, with a short reason.
- You see the proposal in plain words ("Click 'Save As…'"), a screenshot of
  the screen (on the Mac; the phone shows "The screenshot is on the Mac"),
  the step number and today's paid spend, plus **Да** and **Нет**.
- **Да** runs exactly that one action. **Нет** skips it. Then Preyas observes
  again and proposes the next step, one at a time.
- A big **Stop** button is always visible while a session runs. It kills any
  waiting proposal at once, and it works even when the feature is off.

## The text-only limit (important)

Preyas's local model (Qwen3 8B) and DeepSeek flash are TEXT-ONLY models. They
cannot read a screenshot. The model's input is only the text summary of the
frontmost window described above. The screenshot exists only for YOU, so you
can see what you are approving. Nothing else is ever sent anywhere. A real
vision model can be plugged in later behind the same interface — see the last
section.

## What it can never do

The hard deny list is checked twice: before the proposal is shown to you, and
again right before the action runs, against the window that is frontmost at
that moment.

- **These apps are never controlled:** Terminal, iTerm2, Warp, System
  Settings / System Preferences, Keychain Access, Passwords, 1Password,
  Bitwarden, Activity Monitor, Script Editor, Automator.
- **Windows that look like money or accounts are off limits:** any title or
  URL with bank, paypal, stripe, checkout, payment, wallet, revolut, wise,
  kaspi, bunq, "sign in" or password.
- **These key combos are never pressed:** cmd+q, cmd+shift+q, ctrl+cmd+q,
  cmd+opt+esc, cmd+delete, cmd+shift+delete, cmd+opt+shift+q. Return/Enter is
  its own action and is never combined with typing.
- **Typed text:** at most 300 characters, never a newline, and never sudo,
  `rm -`, `curl … | sh`, `git push --force`, `chmod -R`, or anything that
  looks like a key, token or password.
- **These clicks are denied:** delete, erase, format, empty trash, pay, buy,
  purchase, place order, transfer, send money.
- **These clicks get an extra warning** (still Да/Нет every time): send,
  submit, sign out, log out, install.
- The model may never give coordinates: a click names an element from the
  current snapshot, and Preyas clicks the centre of that element.
- At most 20 actions per session (you can change the number in the settings
  file), at least 1 second between actions, and the session ends by itself
  after 2 minutes without a decision.

Hard questions can be handed to DeepSeek: the exact redacted text that would
leave the machine and the cost are shown first, then Да/Нет. Screenshots are
NEVER sent. The daily spend cap still applies.

## Permissions

Two macOS permissions are needed, granted to the app that launches the brain
proxy (Terminal or the launcher app):

1. **Screen Recording** — for the screenshots (System Settings → Privacy &
   Security → Screen Recording).
2. **Accessibility** — for reading the window structure and for clicks and
   keys (System Settings → Privacy & Security → Accessibility).

Without them Preyas answers with a plain message: "Preyas needs Screen
Recording and Accessibility permission for …". Everything about the real Mac
calls is UNVERIFIED until you do the supervised first run below.

## Supervised first run (do this once, step by step)

1. Start Preyas as usual (the launcher), then grant both permissions above
   and RESTART the brain so macOS applies them.
2. Open **TextEdit** and leave it frontmost.
3. Open the Coach popover (the Coach chip in the chat header) and switch on
   **"Let Preyas propose clicks and keys"**. Read the Да/Нет card and press
   **Да**.
4. Type the goal **type hello** and press **Next step**.
5. Look at the screenshot and the proposal. If it is "Type 'hello'", press
   **Да**. Watch TextEdit — the text should appear.
6. Press **Next step** again. If Preyas says the goal is done, great. If he
   proposes anything you do not like, press **Нет**.
7. Press **Stop** once to make sure the session ends immediately.
8. Check the audit log on the drive: `BakuganBuddy/computer/YYYY-MM-DD.jsonl`
   — one line per decision (`yes`, `no`, `expired`, `stopped`), never any
   screenshot bytes. Screenshots live in `BakuganBuddy/computer/shots/` and
   files older than 24 hours are removed automatically.

If any step misbehaves, press Stop and report what happened; nothing runs
without your Да.

## How to switch it off

Switch **"Let Preyas propose clicks and keys"** off in the same panel — no
confirm needed to turn it off. Any waiting proposal dies immediately. The
setting lives in `BakuganBuddy/settings/computer.json`
(`enabled: false`), and only the settings endpoint ever writes that file.

## How to add a vision model later

The model only ever sees text through the `Proposer` interface in
`brain-server/lib/os/computerPropose.mjs`. To add a vision model later:
implement a proposer that also receives the screenshot path (the adapter
already captures it to `computer/shots/<id>.jpg`), describe each element the
same way (`id`, `role`, `label`, position), and keep the same output JSON.
The deny list, the Да/Нет flow, the approval tokens, the action cap and the
log all stay exactly as they are.
