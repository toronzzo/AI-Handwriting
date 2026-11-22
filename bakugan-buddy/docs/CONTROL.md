# Controlling Preyas

One controller does everything: **ON**, **OFF**, **RESTART** and **STATUS**.
You do not need the Terminal for any of it.

## The one-click way (recommended)

On the Desktop there are three files:

| Double-click | What happens |
| --- | --- |
| **Preyas ON.command** | Starts everything that is not already running, waits for each piece, then opens the app. That is `http://localhost:8081` unless another program already holds that port. |
| **Preyas OFF.command** | Stops everything cleanly (SIGTERM first, SIGKILL after 5 s) and frees the RAM. |
| **Preyas RESTART.command** | Stops everything, then starts it again. |

Each one shows a short result and closes its window. If the repo moves, run
`scripts/install-desktop-launchers.sh` once to put fresh copies on the Desktop.

## In the app: Settings > Power

- **Status dots** for the model, paid fallback, offline library, brain and web
  app. A line shows the port and the RAM that service is using.
- **Restart brain** restarts only the brain server (`:8788`), usually in a
  few seconds.
- **Restart model** stops and starts only the model (`:8790`), keeping the
  same size.
- **Turn off everything** asks first, then stops every service. The app cannot
  turn itself back on — use **Preyas ON** on the Desktop.
- **Start when I log in** installs a launchd plist that runs
  `scripts/preyas.sh start` at login. It is **off by default**.

All of these calls go through the paired brain connection; a phone must have
its pairing token before it can see or change the power state.

## Settings > About Preyas

This card is fed by the live capability check. It lists:

- what Preyas can do (files, terminal, browser, offline search, web search);
- which local models are actually on the drive (8B, 14B, 30B, tiny
  off-grid), plus Groq or the paid fallback when they are configured;
- sounds and pictures that are present;
- which services are running right now;
- the newest changelog lines.

If something is not on the list, Preyas should say **"I can't do that yet."**
The same compact list is added to the chat system prompt at startup, and the
first chat after a changelog update starts with **"New since last time: …"**
exactly once. The brain remembers that it said it in
`<dataDir>/memory/self-knowledge.json`.

## What runs, in start order

| Service | Port | What it is |
| --- | --- | --- |
| llama-server | 8790 | the local model (8B by default; 14B / 30B on demand) |
| LiteLLM | 4000 | paid fallback through the Agent-drive gateway |
| kiwix-serve | 8791 | offline Wikipedia / iFixit packs (only when packs exist) |
| brain-server | 8788 | the brain the app talks to |
| Expo web | 8081 | the app in the browser |

`start` skips a service only when its health check passes **and** the process
listening on its port is actually that service (pid file or process arguments).
Another app on the port is never killed. If something else is listening on
8081, Expo web takes the next free port (8082, then 8083, …) and the controller
prints which port and who was in the way. The brain is restarted with
`PREYAS_WEB_PORT` set to that port, so the Mac page stays a trusted local
origin. The Desktop launcher opens the URL the controller prints.

`stop` goes in reverse order. `stop <service>` stops only that one service
(the same names as `restart`). `restart <service>` stops and starts only that
service. Moving Expo off a busy port also restarts the brain so the new origin
is trusted; the other services stay up.

## Logs and PID files

Everything lives in:

    /Volumes/Agent/agent/logs/preyas/

| File | What is in it |
| --- | --- |
| `control.log` | every start / stop / restart request |
| `llama.log`, `litellm.log`, `kiwix.log`, `brain.log`, `web.log` | one log per service |
| `llama.pid`, `litellm.pid`, `kiwix.pid`, `brain.pid`, `web.pid` | the process ids |

If a service will not start, open its log first. Ports in use by another app
are never killed. For the model, the brain, LiteLLM and kiwix the controller
says which port is busy and stops there. For Expo web it moves to the next
free port instead, and writes that port to `web.port` in the log folder.

## The commands behind the buttons

For the curious, or when something is stuck:

```sh
scripts/preyas.sh start
scripts/preyas.sh stop
scripts/preyas.sh stop litellm      # only LiteLLM; the rest keep running
scripts/preyas.sh restart
scripts/preyas.sh restart model      # only the model
scripts/preyas.sh restart brain      # only the brain
scripts/preyas.sh status             # one line per service
scripts/preyas.sh status --json      # what the app reads
scripts/preyas.sh autostart on|off|status
```

## Add a "what's new" line

Edit `bakugan-buddy/CHANGELOG_PREYAS.md` and add a line at the top:

```md
- 2026-11-21 — I can now do the new thing. (#123)
```

Keep the date, the dash and the words **"I can now"**. Preyas will include the
newest five lines in its self-knowledge and say the newest one once after the
next restart.
