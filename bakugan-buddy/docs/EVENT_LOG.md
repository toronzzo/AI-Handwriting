# Event log: money, food, stomach, sleep, books, films

The single source of truth for the user's life data. The log is **append-only**:
one JSON line per event, one file per month. Nothing is ever edited or deleted;
undo is itself an event.

```
<dataDir>/events/YYYY-MM.jsonl
```

`dataDir` is `BAKUGAN_DATA_DIR`, which `launcher/preyas-up.sh` sets to
`/Volumes/Agent/BakuganBuddy` on the Mac.

## Event shape

One line per event, under 4 KB:

```json
{"v":1,"id":"evt_<base36 ts><4 random chars>","ts":1750000000000,"day":"2026-11-18","type":"money","data":{"amount":1500,"currency":"KZT","direction":"out","category":"coffee","note":null},"src":"chat","raw":"coffee 1500₸","parser":"p1"}
```

- `v` — format version (1).
- `id` — unique; the time is base36, plus 4 random chars.
- `ts` — epoch ms; for "yesterday"/"вчера" it is noon of that day.
- `day` — `YYYY-MM-DD` in the configured time zone (the month file comes from
  this field).
- `src` — `chat` | `voice` | `manual` | `tool`.
- `raw` — the original sentence, redacted (secrets), at most 300 chars.
- `parser` — which parser version wrote it (currently `p1`).

Undo is an event too: `{"type":"undo","data":{"of":"evt_..."}}`. `readEvents`
drops any event that has an undo.

### Types and data

| type | data |
|---|---|
| `money` | `{amount (>0), currency, direction "out"\|"in", category \| null, note}` |
| `food` | `{item, meal: breakfast\|lunch\|dinner\|snack\|null}` |
| `stomach` | `{level 0..3, words[], foodId \| null}` (0 fine, 1 mild/bloated, 2 pain/heavy, 3 severe) |
| `sleep` | `{minutes, bedtime HH:MM \| null, wake HH:MM \| null}` |
| `book` | `{title, pages \| null, status started\|reading\|finished, rating \| null}` |
| `film` | `{title, rating \| null, status "watched"}` |

## Settings

`<dataDir>/settings/events.json` — `{tz, currency}`. Defaults: the process
time zone (Europe/Warsaw on the Mac) and `"KZT"`. A missing or invalid file
uses the defaults. Known tenge spellings (₸, тг, tg, tenge, тенге) normalise
to KZT; other currencies pass through and are never converted.

## Parser rules (code only, no model)

`parseEvents(text, {now, tz, currency, recent})`:

- Past or present **facts** only. Questions, wishes, plans and advice requests
  log nothing. When a fact is clear but a number is missing ("I spent a lot",
  "slept well") it returns a question and **never guesses**.
- Money: out verbs spent/bought/paid/потратил/купил/заплатил…; in verbs got
  paid/earned/получил/зарплата…; amounts like `1500₸`, `1 500 тг`, `1.5к`,
  `2 тыс`; a bare number with a money verb uses the default currency; a bare
  number with no money verb and no unit is not money. Category comes from a
  small keyword table (coffee, taxi→transport, food, rent, phone, salary…).
- Food + stomach in one sentence make two linked events ("ate pizza, stomach
  hurts"). A stomach-only sentence links to the most recent food event only
  when there is exactly one in the previous 4 hours (the confirm line says
  "after <item>").
- Sleep: "slept 7h", "спал 6,5 часа", "slept 7 hours 20 min", and
  "went to bed at 00:30, woke up 07:45" (crosses midnight).
- Books/films: pages, finished/дочитал, watched + rating `8/10` or `оценка 8`.
- Dates: "yesterday/вчера" and "today/сегодня" change the day.
- **Crisis**: `detectCrisis` is a separate, documented list of EN/RU phrases.
  When it matches, NO event is written (not even `raw`); the route replies
  with a calm template from `<dataDir>/settings/crisis.json` `{line}`. The
  default line has no phone number:
  *"I am not a doctor. Please contact your local emergency number or someone
  you trust now."*
  **TODO: user to add the right local number** — put it in
  `settings/crisis.json` yourself; the code never guesses one.

## Confirm and undo

One line per log, e.g. `Saved: −1 500 ₸ coffee. Undo for 10 s.` (Russian when
the text is Cyrillic). Several events share the line, joined by " · " (" и ").
Undo works for 10 seconds (+0.5 s grace); later it is refused with "It is
saved. Corrections come in a later version." The same sentence from the same
source within 10 s is idempotent: the first result comes back, nothing is
written again.

## Routes (brain server)

- `POST /v1/events/log` `{text, src?, chatId?}` → `{saved, ids, line,
  undoUntil}` | `{saved:false, ask}` | `{saved:false, crisis:true, line}`.
  Text over 2000 chars → 400.
- `POST /v1/events/undo` `{ids}` → `{undone:[...], refused:[...]}`.
- `GET /v1/events?from=&to=&type=money` → events (no `raw` unless `?raw=1`).
- `GET /v1/events/summary?day=YYYY-MM-DD` → totals per type.
- Terminal tool: `node bakugan-buddy/brain-server/tools/log-event.mjs "coffee
  1500₸"` (needs `BAKUGAN_DATA_DIR`; use a temp dir for experiments).

Wiring the parser into the chat and the Today dashboard is a later UI slice;
this slice is server-side only.
