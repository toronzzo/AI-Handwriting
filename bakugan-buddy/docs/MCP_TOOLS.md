# Preyas's real tools (MCP)

Preyas can now do real work in **task mode**: read, list, search, write and edit
files, run one shell command, and use a headless browser. Everything goes
through the Сторож guard, every risky action asks a Yes/No card first, and
every call lands in the guard audit log.

## What he can do

| Area | Tools | Confirm card? |
|---|---|---|
| Files (read) | `files_read_text_file`, `files_read_multiple_files`, `files_list_directory`, `files_directory_tree`, `files_search_files`, `files_get_file_info`, `files_list_allowed_directories` | No |
| Files (write) | `files_write_file`, `files_edit_file`, `files_create_directory`, `files_move_file` | **Yes** |
| Terminal | `shell_run` — ONE command, 60 s hard timeout, output capped at 4 000 chars | **Yes** |
| Browser (read) | `browser_navigate`, `browser_snapshot`, `browser_console_messages`, `browser_network_requests`, `browser_tabs`, `browser_wait_for`, `browser_take_screenshot`, `browser_navigate_back` | No |
| Browser (act) | `browser_click`, `browser_type`, `browser_fill_form`, `browser_select_option`, `browser_hover`, `browser_drag`, `browser_press_key`, `browser_file_upload`, `browser_handle_dialog`, `browser_evaluate` | **Yes** |
| Notes | `search_notes` (your saved notes, BM25) | No |

File tools are confined to **/Volumes/Agent and the repo folder** — both the
MCP servers and the guard check every path, symlinks included. Anything named
`secrets`, `.env`, `*.pem`, `*.key`, `id_rsa*`, `*token*` or `~/.ssh` is off
limits for files AND for shell commands. The shell also runs with secret-looking
environment variables (KEY/TOKEN/SECRET/PASSWORD) removed.

## How a task runs

1. You ask something like *"list the files in my Data Warehouses folder"*,
   *"create test.txt in /Volumes/Agent/agent/tmp saying hi"* or *"open
   example.com and tell me the title"*. A request with a file, folder, URL or
   an action word becomes a task.
2. The task loop plans, then makes **one tool call per step**, feeds the result
   back to the model, and stops after at most **15 steps** with a final answer
   that lands in the chat. Progress is saved to `memory/tasks/` after every
   step, so a restart can resume.
3. When a step needs your OK, the task pauses and a Yes/No card appears in the
   chat. **Yes** runs it, **No** skips it; unanswered cards expire after
   5 minutes.

## Models and money

- Tool tasks run on **DeepSeek Flash** through the LiteLLM gateway on
  `127.0.0.1:4000` (it handles tool calls well). Plain chat stays on the local
  Qwen3-8B. **Kimi is never used**, unless you pick it yourself.
- Task spend is logged to `<dataDir>/spend/tasks.jsonl` and counts toward the
  same daily cap as paid chat and Harness runs. When the cap is reached — or
  the gateway is down — the task falls back to the local model in a strict
  JSON mode, so tasks still work for free.
- The local fallback keeps its prompt inside 16K context (old tool results are
  trimmed first), because the Mac has 16 GB.

## Memory care

The Playwright server is **lazy**: it starts only when a browser tool is really
used and stops after **5 minutes without a browser call**. The files and shell
servers are small and stay up while the brain runs; all three die with the
brain proxy.

## Configuration

The servers are configured in `<dataDir>/mcp/servers.json` (written on first
use). You can disable a server (`"enabled": false`), narrow the file roots
(only inside /Volumes/Agent or the repo folder), change the shell timeout and
output cap, and set the browser idle time. Edit the file by hand and restart
Preyas.

Install the servers once after pulling this change:

```bash
cd bakugan-buddy/brain-server
npm ci
```

The Playwright browser itself (Chromium) lives in `~/Library/Caches/ms-playwright`.
If the first browser task says the browser is missing, run
`npx playwright install chromium` inside `bakugan-buddy/brain-server`.

## Guard rules

New kinds in the Сторож rule engine: file writes are **R9** (always ask),
shell commands are **R10** (always ask, secrets blocked by R2), interactive
browser actions are **R8** (always ask). Reads are allowed when R1, R2 and R7
pass. The audit log keeps every review under `<dataDir>/guard/`.

## Tests

`npm run test:os` covers: tool listing against a fake MCP server, path-escape
refusals, the shell timeout and output cap, confirm required for write/shell
but not read, and the 15-step loop cap. The real filesystem and terminal
servers are exercised over stdio in the same suite (no network).
