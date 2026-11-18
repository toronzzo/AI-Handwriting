---
name: Pull and refresh
when: ["pull main", "git pull", "update the app", "refresh preyas", "see the new look", "after merge", "pull and refresh", "обновить", "подтянуть main", "обновить preyas", "после мержа"]
escalate_if: ["git pull says there are local changes that would be overwritten", "git pull says the branches have diverged", "npm install fails", "the page stays white or shows an error after a refresh"]
risk: low
version: 1
---
# Pull and refresh

After a PR is merged on GitHub, your Mac still has the old files. This skill brings the new code to the Mac and shows it in the browser.

UNVERIFIED: the repo folder path on your Mac. In the commands below, `<repo>` means the folder that contains bakugan-buddy/ (the AI-Handwriting folder). Tell the coach the real path once and it will remember it as a note.

## Steps

### 1. Go to the repo and check it is clean
Do: Open Terminal. Go to the repo folder and look at the state.
Command: `cd <repo>`
Command: `git status`
Why: A pull only works safely when you have no unsaved changes there.
Check: It says "On branch main" and "nothing to commit, working tree clean".
Expect: /On branch main[\s\S]*working tree clean/i
Bad: /Changes not staged|Untracked files|Changes to be committed/i
Fail-hint: Another branch or changed files? Paste the output here. Do not use git reset or git stash without asking first.

### 2. Pull the new main
Do: Pull only if Git can do it as a simple fast-forward.
Command: `git pull --ff-only`
Why: --ff-only refuses anything complicated instead of creating a messy merge.
Check: It prints "Updating ... Fast-forward" and a list of files, or "Already up to date."
Expect: /Fast-forward|Already up to date/i
Bad: /fatal|diverged|overwritten/i
Fail-hint: An error? Paste it here. Never use --force or reset --hard to get past it.

### 3. See what kind of change it was
Do: Look at which files changed.
Command: `git diff --name-only ORIG_HEAD HEAD`
Why: It tells you which of the next steps you need. Files in apps/mobile/src change the web app (hot reload). Files in brain-server change the brain (restart needed). package.json or package-lock.json mean new packages.
Check: You can tell if the list contains brain-server/ files, or package.json or package-lock.json.
Fail-hint: The command prints nothing after "Already up to date."? Then nothing changed. Go to step 6.
Ack: yes

### 4. Install new packages only if needed
Do: If package.json or package-lock.json in bakugan-buddy/apps/mobile changed, install. Otherwise skip this step and say "skip".
Command: `cd bakugan-buddy/apps/mobile && npm install`
Why: New code may need new libraries. The repo README uses npm install.
Check: It ends with "added" or "up to date" and no "npm ERR!".
Expect: /added \d+ packages|up to date|skip/i
Bad: /npm ERR!/i
Fail-hint: npm ERR? Paste the last 20 lines here.

### 5. Restart the brain only if brain-server changed
Do: If step 3 listed files under bakugan-buddy/brain-server, restart Preyas with the skill `restart-preyas`. Otherwise skip this step and say "skip".
Why: The brain proxy reads its code only when it starts.
Check: Either you ran restart-preyas, or no brain-server files changed.
Expect: /restart|skip|no brain/i

### 6. Refresh the page
Do: Open http://localhost:8081 and press Cmd+Shift+R (hard reload).
Why: The browser keeps old files in memory. A hard reload loads the new ones. Day and night colours follow the clock: day 06:00 to 18:59, night 19:00 to 05:59.
Check: The page loads and shows the new change. Tell me what you see.
Fail-hint: White page or an error box? Paste the error text. UNVERIFIED: if nothing opens on port 8081, run `restart-preyas`.
Ack: yes

## Checks
- On main, clean, up to date with origin/main. Packages installed if needed. Brain restarted if needed. Page hard-reloaded.

## Common mistakes
- Pulling while on another branch (you pull into the wrong branch).
- Forgetting the brain restart after brain-server changes.
- Looking at the old page without a hard reload.

## Glossary
- fast-forward: Git just moves main forward to the newer commits. No new commit is created.
- hard reload: Cmd+Shift+R, reload ignoring the browser's saved files.
