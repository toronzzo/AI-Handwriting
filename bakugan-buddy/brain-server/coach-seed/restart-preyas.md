---
name: Restart Preyas
when: ["restart preyas", "stop preyas", "start preyas", "preyas is not working", "brain is down", "port 8788", "перезапустить preyas", "перезапуск", "preyas не отвечает", "запустить preyas"]
escalate_if: ["port 8788 is held by another app", "the Agent drive is not mounted", "llama-server does not answer on 8790", "the proxy log shows an error you do not recognise"]
risk: low
version: 1
---
# Restart Preyas

Preyas is several small programs. The launcher scripts start only what is missing and stop only what they started themselves.

Ports (from bakugan-buddy/launcher/preyas-up.sh):
- 8790 llama-server (the local brain model)
- 8788 brain proxy (the app talks to this)
- 8178 whisper (voice, optional)
- 4000 paid gateway (DeepSeek, optional, needs a key on the drive)
- 8081 the web app you open in the browser

Logs are in /Volumes/Agent/agent/logs (preyas-up.log, preyas-proxy.log, expo.log, llama.log).

UNVERIFIED: how you normally start Preyas (the Preyas.app / login item from launcher/install.sh, or ./start.sh in a Terminal). This skill uses the launcher scripts. `<repo>` is the folder that contains bakugan-buddy/.

## Steps

### 1. Check the drive
Do: Make sure the Agent drive is plugged in and mounted.
Command: `ls /Volumes/Agent`
Why: Preyas keeps its data on the drive and refuses to run without it.
Check: You see folders such as agent and BakuganBuddy.
Expect: /agent|BakuganBuddy/
Fail-hint: "No such file or directory"? Plug in the drive and wait a few seconds, then try again.

### 2. Stop what the launcher started
Do: Run the stop script. It stops the brain proxy, the web app and the gateway only if the launcher started them.
Command: `cd <repo> && bakugan-buddy/launcher/preyas-down.sh`
Why: A clean stop avoids two copies fighting for the same port. llama-server is normally left running.
Check: It prints "Preyas stopped." at the end.
Expect: /Preyas stopped/i
Fail-hint: "permission denied"? UNVERIFIED: the script may need `chmod +x`. Paste the message first.

### 3. Start again
Do: Run the start script. Add --no-open if you do not want a browser tab to open.
Command: `cd <repo> && bakugan-buddy/launcher/preyas-up.sh`
Why: It starts only what is missing and prints the address when done.
Check: The last lines say "Preyas is at http://localhost:8081".
Expect: /Preyas is at http:\/\/localhost:8081/
Bad: /Refusing to kill|did not appear|did not start/i
Fail-hint: It says port 8788 is held by another app? Do not kill it. Paste the line here. Find out who holds it with: lsof -nP -iTCP:8788 -sTCP:LISTEN

### 4. Check the brain answers
Do: Ask the brain and the model if they are healthy.
Command: `curl -s http://127.0.0.1:8788/v1/health`
Command: `curl -sf http://127.0.0.1:8790/health`
Why: Proves both the proxy (8788) and llama (8790) are up.
Check: The first prints JSON with "service":"bakugan-brain". The second prints ok or JSON without an error.
Expect: /bakugan-brain/
Fail-hint: Nothing printed? Look at the log: tail -n 30 /Volumes/Agent/agent/logs/preyas-proxy.log and paste it here.

### 5. Open the app
Do: Open http://localhost:8081 and press Cmd+Shift+R.
Why: Loads the app against the fresh brain.
Check: The chat opens and shows Preyas online.
Ack: yes

## Checks
- Drive mounted, proxy healthy on 8788, llama healthy on 8790, page loads on 8081.

## Common mistakes
- Killing a process on a port with kill -9 without knowing who owns it.
- Restarting while a Harness run is working in the repo (the Harness rules say to leave ports 8790, 8788, 8081 and 4000 running; restarting is YOUR job after the run, not Harness's).
- Forgetting to mount the drive.

## Glossary
- port: a numbered door on your Mac that a program listens on.
- proxy: the small server between the app and the model.
- health check: a quick request that only answers "I am alive".
