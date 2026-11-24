# Harness CLI: how Preyas starts DeepSeek Harness

Investigated on this Mac on 19 Nov 2026, read-only (STEP 0 of slice 13). No Harness
task and no paid request was started during the investigation. The findings below
are what the code in `brain-server/lib/harness/adapter.mjs` is built on.

## What is installed

- **DeepSeek Harness Desktop**, an Electron app at
  `/Applications/DeepSeek Harness.app`. It is how Harness runs normally on this
  Mac (there is no `dsh` on `PATH`).
- The desktop host process is started as (from `ps`):
  ```
  /Applications/DeepSeek Harness.app/Contents/MacOS/DeepSeek Harness \
    --expose-internals /Applications/DeepSeek Harness.app/Contents/Resources/app.asar/dsh/node_modules/@deepseek-ai/dsh-desktop-host/lib/index.js \
    /Applications/DeepSeek Harness.app/Contents/Resources/app.asar/dsh \
    /Users/toronzzo/.dsh/profiles/desktop ...
  ```
- The CLI package is `@deepseek-ai/dsh` **0.2.2-rc.2** (verified from its
  `package.json`). Its bin entry is
  `.../app.asar/dsh/node_modules/@deepseek-ai/dsh/lib/bin.js`.
- The user's profile folder is `~/.dsh`: `profiles/desktop`, `profiles/headless`,
  `sessions/`, `storages/`, and `.credentials.yaml`. The credential file is never
  read by this project (names only, and no values are printed anywhere).
- The Electron binary can run the CLI as Node when it is started with
  `ELECTRON_RUN_AS_NODE=1`. The app ships a wrapper that does exactly this:
  `Contents/Resources/runtime/bin/node` is
  `exec "$DSH_DESKTOP_NODE_EXECUTABLE" --expose-internals "$@"` with
  `ELECTRON_RUN_AS_NODE=1` exported. There is no Node 24 on `PATH` here (system
  Node is 22.20), so the app's Electron binary is the runtime to use.

## Command

Launching the CLI from this Mac:

```
ELECTRON_RUN_AS_NODE=1 \
  "/Applications/DeepSeek Harness.app/Contents/MacOS/DeepSeek Harness" \
  --expose-internals \
  "/Applications/DeepSeek Harness.app/Contents/Resources/app.asar/dsh/node_modules/@deepseek-ai/dsh/lib/bin.js" \
  <arguments>
```

Verified help output:

- `dsh --help` — "boot a DeepSeek Harness profile … an ordered stack of plugin-bundle patch layers".
- `dsh headless "run the tests"` — "answer one task, print the result, and exit".

There **is a documented non-interactive mode** (`dsh headless`), so the repo may
use the real `CliAdapter`; it is not guessed.

### `dsh headless` flags (from `headless --help`)

| Flag | Meaning |
| --- | --- |
| `task...` | the task text; multiple words are joined by spaces |
| `-` (as the task) | read the task from stdin; the only stdin marker |
| `--json` | write newline-delimited JSON run events to stdout instead of the final message |
| `--session-id <id>` | adopt the persisted Session with this id |
| `--permission-mode <preset>` | pick a configured permission preset for this task |
| `--approval-policy <preset>` | `ask` or `never`; `never` rejects calls that need a human |
| `--add-dir <path>` | allow an extra physical absolute directory (repeatable) |
| `-h, --help` | print help and exit without running anything |

`dsh --profile headless …` is the same command; the profile lives in
`~/.dsh/profiles/headless` (bundles `@deepseek-ai/dsh-base` and
`@deepseek-ai/dsh-headless`).

### How the prompt is passed

- Words after `headless` are joined with spaces.
- A lone `-` means "read the task from stdin"; mixing `-` with other words is a
  usage error.
- With no task at all and a pipe on stdin, stdin is the task.
- The docs recommend the stdin form for supervision:
  `dsh headless --permission-mode workspace-write --add-dir <git-dir> --json - < task.txt`.

This project always sends the prompt through stdin with `-`: long prompts never
hit argv limits and nothing has to be escaped.

### What the output looks like

Without `--json`: the final answer goes to **stdout**, diagnostics to stderr.

With `--json`: one JSON object per line on stdout; stderr keeps only `dsh:`
diagnostics. The stream opens with `session` and closes with `final`, and carries
`status`, `text`, `thinking`, `tool_call` and `tool_result` events in between.
Tool events look like this (from the installed projection source):

```json
{"type":"tool_call","callId":"…","tool":"bash","input":{…}}
{"type":"tool_result","callId":"…","status":"completed","result":"…"}
{"type":"final","sessionId":"session-…","reason":{"kind":"completed"},"text":"the answer"}
```

Exit codes: **0** = the task completed, **1** = aborted or errored.

### How it is stopped

The headless docs say the process stays alive only for the run, opens no listening
port, and exits on its own. No stop signal contract is documented for
`dsh headless`, so this project's adapter stops it the safe Unix way: the child is
spawned `detached` (its own process group), `stop()` sends `SIGTERM` to the whole
process group, then `SIGKILL` after 3 seconds. A hard timeout from
`HARNESS_MAX_MINUTES` (default 30) does the same thing.

### Environment variable names the CLI reads

- `DEEPSEEK_API_KEY` — the default `apiKeyEnv` of the DeepSeek route
  (`@deepseek-ai/dsh-llm-deepseek-api-key`). The value is never printed, logged or
  committed.
- `DEEPSEEK_BASE_URL` — optional endpoint override for that route.
- The desktop keeps credentials in `~/.dsh/.credentials.yaml` and the launch
  environment may also use `$DSH_HOME/.env`; this project does not read either.
- The adapter passes the secret values from
  `/Volumes/Agent/agent/secrets/.env` only through the child's environment.

## The invocation this project uses (CliAdapter)

```
cwd: the repository root (the folder that contains bakugan-buddy/)
env: inherited process env + the values from /Volumes/Agent/agent/secrets/.env
     + ELECTRON_RUN_AS_NODE=1
argv: <Electron binary> --expose-internals <lib/bin.js>
      headless --json --permission-mode workspace-write --approval-policy never -
stdin: the drafted prompt, then EOF
```

`--approval-policy never` is the documented unattended choice: there is no live
approval channel in headless, so a call that would need a human is rejected
instead of hanging. `--permission-mode workspace-write` is the documented preset
for a supervised implementation task. No `--add-dir` is passed because the
repository's `.git` lives inside the working directory; that grant is for shared
Git metadata (separate worktrees).

Overrides for another install location or Node 24 (optional, in `brain.env`):

- `HARNESS_CLI_BIN` — path to `lib/bin.js`
- `HARNESS_CLI_RUNTIME` — executable that runs it (default: the app's Electron
  binary; it is started with `ELECTRON_RUN_AS_NODE=1`)

## Setup

Everything here is the user's to set once; Preyas can never change it.

1. **Prices** (required before any run can start). Put the real DeepSeek prices in
   `brain-server/brain.env` (the bridge between the drive and the server). The
   values are USD per million tokens; nothing is hard-coded in the repo:

   ```
   HARNESS_USD_PER_MTOK_IN=…      # read the current price on the DeepSeek site
   HARNESS_USD_PER_MTOK_OUT=…     # read the current price on the DeepSeek site
   HARNESS_OUT_TOKENS_MAX=20000   # optional output allowance for the estimate
   HARNESS_MAX_MINUTES=30         # optional hard stop for one run
   HARNESS_ADAPTER=cli            # optional: cli (default when found) or fake
   ```

   Read the prices on the DeepSeek pricing page yourself — do not trust a number
   from this file. If either price is missing, the estimate is empty and the guard
   refuses every run (fail closed) with the message
   "Set HARNESS_USD_PER_MTOK_IN and _OUT in brain.env (check the DeepSeek price page)".

2. **Daily limit.** The limit is **$1.00 a day by default**, shared with every paid
   run (paid chat, chat escalation, computer escalation, tasks and Harness). The
   user changes it in the app under **Settings → Daily limit**, and it is stored in
   `<data root>/settings/spend.json` (`{"dailyCapUsd": …, "updatedAt": …}`).
   Lowering it below today's spend is allowed and simply blocks new runs until
   tomorrow; raising it applies immediately. Preyas has no tool that can change
   the limit (the only writer is the proxy's `POST /v1/settings/spend` route, which
   requires `confirm: "save"`).

   The limit is checked on the Mac **before** any paid request leaves it, and the
   brain writes every paid line itself into `<data root>/spend/paid.jsonl`
   (`{t, usd, src}`) from the usage the provider reported; a cost the app puts on
   its own message is only a label and never decides the cap. A paid chat turn
   reserves its worst case while it runs, so two turns cannot both spend the same
   last cents, and that room comes back on failure, timeout or a phone that walks
   away. `GET /v1/paid` reports today's spend and cap, and turns the paid route off
   with the numbers when the limit is reached.

3. **Protect `main` on GitHub.** Turn on branch protection for `main` and require a
   pull request plus passing checks before merging. Then even a bad run cannot push
   to `main`: it has no merge path in this repo, and GitHub itself refuses a direct
   push.

## Unknowns (not verified in this slice)

- No real headless task was run, by rule (development must not spend money). The
  stream parsing is tested against the documented event shapes, not against a live
  run.
- The `headless` profile had no installed `node_modules` at investigation time; the
  first real run will resolve its bundles. Whether that works offline with the
  desktop's bundled packages, and which model route the fresh headless profile
  selects by default, is untested.
- Whether the headless profile picks up a `DEEPSEEK_API_KEY` from the child
  environment in this desktop composition (the package documents it as the default
  `apiKeyEnv`) is untested end-to-end.
- The exact `final.reason.kind` spelling is taken from the headless README; only
  `"completed"` counts as success here.
