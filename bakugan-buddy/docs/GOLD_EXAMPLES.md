# Gold examples: 👍 saves a good answer into the prompt

The user marks a good Preyas answer as a **gold example**; Preyas keeps the
question + answer, and for each new question the **2 most relevant examples**
ride into the system prompt as style guides ("copy the style, not the
facts"). This is cheap experience with no training.

## Saving

Two ways, both server-side through the same store:

1. **In the chat:** type one of `👍`, `save example`, `save as example`,
   `сохрани как пример`, `запомни ответ` (the whole message, nothing else).
   The coach engine saves the newest chat's last **model** answer plus the
   user message before it and replies one line: "Saved as example #n" or the
   refusal reason. Works with and without a running coach session.
2. **Button:** "👍 Save last answer" in the coach popover calls
   `POST /v1/examples` with no body.

What is refused, with a clear reason:

- no model answer to save (the last reply was a command reply like
  "Saved to notes: …" or a coach step),
- the answer contains `[[ASK_PAID]]`,
- empty question or answer,
- a duplicate (same normalised question + answer, still active).

Labels the save uses: real local replies carry `who: "preyas"` with
`model: "preyas"`, paid replies `who: "paid"` with `model: "deepseek-flash"`;
several command replies reuse `model: "preyas"`, so a content check also
applies.

## Store

Append-only `<dataDir>/gold/examples.jsonl`, one line per example:
`{v:1, id, ts, q, a, lang, source}`. `q` at most 600 chars, `a` at most 1200,
both redacted. Removal is a **tombstone** line `{v:1, type:"remove",
of:"gx_…"}` — nothing is ever rewritten or deleted.

Routes: `POST /v1/examples {q?, a?}` (default: the last pair),
`GET /v1/examples?limit=300` (newest 300 active, at most 150 KB total),
`GET /v1/examples/stats` (`{active, ru, en}`),
`DELETE /v1/examples/:id` (tombstone).

## Retrieval

The prompt is built on the client (the :4000 gateway route bypasses the
proxy), so the client ranks the examples through the B1 seam
`registerChatExtras`: `pickExamples(items, userText, {limit: 2, minScore})`
ranks with `scoreNotes` (BM25, Cyrillic-safe) over the question (weight 1)
plus the first 200 chars of the answer (weight ~0.3). Nothing is picked when
the user text is shorter than 8 characters, looks like a command
("/", coach/коуч, vault, note or reminder commands), or the best score is
below `EXAMPLE_MIN_SCORE` (currently **0.5**, tuned on the fixture
questions). `formatExamples` builds the block "Examples of good answers
(copy the style, not the facts):" with Q/A pairs, each pair ≤ 480 chars, the
whole block ≤ 1000 chars, never cutting inside a word.

The app fetches `/v1/examples` on load, every 10 minutes (skipped while
hidden) and right after a save; errors keep the old list, and with no list
the extras are empty.
