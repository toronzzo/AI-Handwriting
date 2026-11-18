# Preyas persona: the versioned chat prompt

The chat persona (who Preyas is and how he answers) lives in one file that you
can edit by hand, no rebuild needed:

```
<dataDir>/persona/chat-system.txt
```

`dataDir` is `BAKUGAN_DATA_DIR`, which `launcher/preyas-up.sh` sets to
`/Volumes/Agent/BakuganBuddy` on the Mac.

## Where the text comes from

- The repo carries the default persona in
  `bakugan-buddy/packages/alive/src/persona.ts` (`PREYAS_CHAT_PERSONA`).
- On the first start after this feature, the brain writes the default to
  `chat-system.txt` as **revision 1**.
- The app loads `/v1/persona` once on start and every 10 minutes (skipped
  while the page is hidden). When the file's sha256 changed, the new text
  replaces the system prompt — no restart needed, usually within 10 minutes.

## How to edit it by hand

1. Edit `chat-system.txt` with any text editor. Save.
2. On the next load the brain records the change: a new line in
   `versions.jsonl` with `source: "user"` and a full copy in
   `history/rev-XXXX.txt`.
3. Refresh the web app (or wait at most 10 minutes) and Preyas answers with
   the new persona.

Rules the text must keep (otherwise the brain keeps serving the default and
adds a warning in `/v1/persona`):

- at most **2400 characters** (about 600 tokens — the 16K llama context is
  shared with history, notes and the drive map),
- no NUL bytes,
- it must contain the **`[[ASK_PAID]]`** rule (the app parses that marker to
  offer the paid ask).

## Versions

- `versions.jsonl` — append-only, one line per revision:
  `{v:1, rev, sha256, savedAt, source, chars}`. `source` is `default`,
  `user`, or `default-upgrade`. Nothing ever rewrites old lines.
- `history/rev-0001.txt` … — a copy of every revision, for diffing.

## Going back to the default

Delete `chat-system.txt` (or rename it). On the next load the brain writes
the current repo default as a fresh revision. Or copy the text from
`persona.ts` back into the file by hand — that counts as a `user` revision.

## Upgrades

When the repo ships a newer default, the brain compares it with the last
default revision:

- if you never edited the file, it is upgraded automatically
  (`default-upgrade`);
- if you edited it, your text stays and `/v1/persona` reports
  `upgradeAvailable: true` so you can decide yourself.

The persona is **read-only for Preyas**: there is no write route. He cannot
rewrite his own prompt.
