# Сторож: the auto-review guard

Before Preyas runs any tool action, a cheap check asks: *does this match what
the user asked, and is it allowed?* Rules decide first; the local model is
only a tie-breaker; a block explains itself in plain words. This is the seed
of the Сторож (watchdog).

## Action shape

`{kind, args, userRequest, origin, source}` — `userRequest` is the last thing
the user typed (redacted, at most 500 chars); `origin` is `"user"` or
`"content"` (the idea came from a web page, document or note, not from the
user); `source` is `task | chat | coach | computer | harness`.

| class | kinds |
|---|---|
| read | `read_file`, `list_files`, `search_notes`, `search_vault` |
| write | `write_vault`, `add_note`, `add_reminder` |
| destructive | `delete_note`, `delete_reminder`, `delete_file`, `overwrite_file` |
| paid | `paid_call`, `run_harness` |
| control | `computer_click`, `computer_keys`, `computer_open_app` |

Unknown kinds are blocked.

## The rules (guardRules.mjs)

- **R1** — unknown kind → block. Example: `{kind:"hack_mainframe"}` → block.
- **R2** — file paths must resolve under the safe root (`resolveSafePath`);
  any segment named `secrets`, any file `.env*`, `*.pem`, `*.key`,
  `id_rsa*`, `*token*` → block "secrets are off limits". Example:
  `read_file /Volumes/Agent/agent/secrets/.env` → block.
- **R3** — destructive kinds: block unless the user's own words contain clear
  destructive intent (delete/remove/erase/overwrite/удали/сотри/убери/
  перезапиши); even then the verdict is `ask` (confirm card), never allow.
  Example: "summarise my notes" + `delete_note` → block; "delete the note
  about taxes" → ask.
- **R4** — paid kinds: `allowPaid` from the Coach slice's spend gate; over
  the cap or an unknown price → block "daily limit"; otherwise `ask` (the
  card shows the cost). Example: cap $1.00, spent $0.99, a $0.05 ask → block.
- **R5** — origin `content` + class write/destructive/paid/control → block
  "an instruction found inside content, not from you".
- **R6** — write kinds need a fitting intent word (save/remember/note/
  запомни/сохрани → write_vault, add_note; remind/напомни → add_reminder).
  No fit → `unsure` (the model tie-breaker, otherwise ask).
- **R7** — argument sanity: string args at most 4000 chars, no NUL/control
  characters, no `..` path segments, no URL schemes other than http/https.
- **R8** — control kinds are always `ask` unless a later slice's deny list
  blocks them first; the guard never returns `allow` for control.

Read kinds that pass R1, R2 and R7 are allowed.

## The model tie-breaker (guard.mjs)

Only when the rules return `unsure`. One call to the local llama
(temperature 0, thinking off, at most 1500 characters of context, 6 s
timeout) asking for strict JSON `{"match":"yes|no|unsure","why":"…"}`.
`yes` → allow **only for the write class**; no/unsure/bad JSON/timeout/no
llama → `ask`. The model can never turn a block or an ask into an allow, and
never touches destructive, paid or control actions — it can only tighten.

## API

- `reviewAction(action, deps)` → `{verdict: "allow"|"ask"|"block", rule,
  why, needsConfirm, model}`. Writes the audit line when `dataDir` is set; a
  log failure never changes the verdict.
- `guardedRun(action, deps, fn)` runs `fn` only on `allow` (or on a stored
  one-time approval for `ask`) and returns `{ran, verdict, …}`.
- `createApprovals()` — single-use approval tokens bound to a hash of the
  action, valid 60 s; a changed action or a second use fails.
- Routes: `POST /v1/guard/review {action}` (dry run, nothing executes);
  `GET /v1/guard/log?day=YYYY-MM-DD` (audit lines).

## Audit log

Append-only `<dataDir>/guard/YYYY-MM-DD.jsonl`, one line per review:
`{v:1, ts, kind, source, verdict, rule, why, argsPreview, model}`.
`argsPreview` is redacted (Coach slice redactor) and at most 200 chars.

## Where it hooks today

`taskRunner.mjs` reviews every tool step before it runs. On block the step's
result is "Blocked by the guard: <why>" and the task goes on; in a task
context `ask` is treated as "needs your OK" (tasks have no confirm card yet).

## NOT covered yet

The proxy action routes (`/v1/vault/save`, note delete, reminders, paid
asks) still rely on the app's own confirm cards; this slice does not edit
them. Later callers that must be guarded: B6 computer use, and the UI plan's
Generate button — both should use `reviewAction`/`guardedRun`.
