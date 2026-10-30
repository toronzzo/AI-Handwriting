# Agent Drive

This checkout sits on the external-drive workspace. The drive root is `$AGENT_DRIVE_ROOT` (default `/Volumes/Agent/agent`). If that folder is missing, the drive is unplugged: stop and say so. Do not write caches, models, or secrets onto the internal disk.

## Before starting

1. Read `$AGENT_DRIVE_ROOT/skills/INDEX.md`, then the one skill that matches the task.
2. Skim `$AGENT_DRIVE_ROOT/notes/` (and `notes/plans/` if this work continues a plan).
3. Check `$AGENT_DRIVE_ROOT/history/` and `$AGENT_DRIVE_ROOT/cache/` for an earlier result before calling a model or redoing a long step. Reuse a hit.

## While working

- Send model calls to the local gateway `http://127.0.0.1:4000/v1` with model `local`, and pass `metadata.session_id` from `new_session.py` when you have one. That path is cached on the drive and written to history. DeepSeek (`paid` / `deepseek-flash`) is only the fallback when local is down, or an explicit model name. Use `deepseek-v4-pro` only for a harder task. Do not rewrite `$AGENT_DRIVE_ROOT/prompts/deepseek-prefix.txt`; variable text goes after that prefix.
- For a big task, first write a short plan at `$AGENT_DRIVE_ROOT/notes/plans/YYYY-MM-DD-<slug>.md`. Only the goal, when it is done, and the steps that matter. Then use compact prompts: no pasted logs, no repeated file dumps, no restated plan.

## After finishing

- Save or update a skill recipe in `$AGENT_DRIVE_ROOT/skills/<name>.md` (when to use it, the steps, what to skip).
- Add or update one row in `$AGENT_DRIVE_ROOT/skills/INDEX.md`.
- Leave secrets in `$AGENT_DRIVE_ROOT/secrets/.env` only. Never commit keys, `.env`, or model weights.
