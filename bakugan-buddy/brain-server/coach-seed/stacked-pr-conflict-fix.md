---
name: Fix a stacked PR conflict
when: ["conflict", "merge conflict", "stacked pr", "pr has conflicts", "cannot merge", "cherry-pick", "worktree", "base branch is not main", "конфликт", "стек пр", "не могу смержить", "черри-пик"]
escalate_if: ["cherry-pick shows conflicts in many files", "you are not sure which commit is the slice's own commit", "git says you have uncommitted changes you do not remember"]
risk: danger
version: 1
---
# Fix a stacked PR conflict

What happened on 18 Nov 2026: slice 2 and slice 3 were opened as PRs whose base was the previous slice's harness branch (stacked PRs #49 and #50). After slice 1 was squash-merged into main (#48), the later PRs showed conflicts. The fix was to replay each slice's own commit on a fresh branch from main (#51 and #52, "Supersedes #49 / #50").

Why it happens: a squash-merge puts ONE new commit on main. The older branch still holds the original commits, so Git thinks the same lines were changed in two different ways.

Prevention (best fix): every Harness prompt branches from main, and you wait for the previous PR to merge before pasting the next prompt.

The exact commands used on that day were not recorded; the steps below are standard Git, UNVERIFIED on this repo until you run them once with the coach.

## Steps

### 1. Stay calm and look, do not change anything
Do: In Terminal, go to the repo folder and look at the state.
Command: `git status`
Why: You need to know if you have unsaved work before you touch branches.
Check: It says "nothing to commit, working tree clean".
Expect: /working tree clean/i
Fail-hint: Not clean? Paste the output here. Do not continue until we know what those files are.

### 2. Get the newest main and find the slice's own commit
Do: Fetch, then list the commits that are on the stuck branch but not on main. Replace <branch> with the stuck branch name, for example harness/ui-shell.
Command: `git fetch origin`
Command: `git log --oneline origin/main..origin/<branch>`
Why: The list shows the commits you must replay. The slice's own commit is usually the newest one. Earlier ones belong to the previous slice, which is already in main.
Check: You can name the commit that belongs to this slice (usually one line, the top one).
Fail-hint: Not sure which line is the slice's? Paste the list here and say "ask DeepSeek" or "ask Grok Bot".

### 3. Make a separate working folder (a worktree) from main
Do: Create a new branch from origin/main in a new folder next to the repo. Replace <name> with the slice name, for example ui-shell.
Command: `git worktree add ../AI-Handwriting-fix -b cursor/<name> origin/main`
Why: A worktree is a second checkout. Your normal folder, and the running Preyas, stay untouched.
Check: The command prints "Preparing worktree" and a new folder ../AI-Handwriting-fix exists.
Expect: /Preparing worktree|HEAD is now at/i
Fail-hint: "already exists" or "is already checked out"? Paste the message. Do not use --force.

### 4. Replay the slice's commit
Do: Go into the new folder and cherry-pick the commit from step 2. Replace <sha> with the short code at the start of that line.
Command: `cd ../AI-Handwriting-fix`
Command: `git cherry-pick <sha>`
Why: Cherry-pick copies just that one change on top of main.
Check: It ends without "CONFLICT". If the list had two slice commits, pick them oldest first.
Expect: /\[cursor\/[a-z0-9-]+ [0-9a-f]+\]/
Bad: /CONFLICT/
Fail-hint: CONFLICT? Run `git status`, paste it here. To undo and start over: git cherry-pick --abort (this is safe).

### 5. Run the checks locally
Do: Run the project checks in the app folder.
Command: `cd bakugan-buddy/apps/mobile`
Command: `npm run typecheck && npm test`
Why: Make sure the replayed change still works on the newest main.
Check: Both commands end without errors.
Expect: /^(?![\s\S]*(error TS|# fail [1-9]))[\s\S]*$/
Fail-hint: Errors? Paste the last 20 lines. UNVERIFIED: you may need to run `npm install` first if node_modules is missing.

### 6. Push the new branch and open a new PR
Do: Push the branch and open a PR to main. In the PR body write "Supersedes #<old PR number>".
Command: `git push -u origin cursor/<name>`
Command: `gh pr create --base main --title "<slice title> (replayed on main)" --body "Supersedes #<old>"`
Why: A new clean PR can merge. The old stacked PR is then closed.
Check: gh prints the new PR link and the PR page says "into main".
Expect: /github\.com\/toronzzo\/AI-Handwriting\/pull\/\d+/
Fail-hint: Push rejected? Paste the message. Never use --force.

### 7. Merge the new PR, close the old one
Do: Run the skill `review-and-merge-pr` for the new PR. Then close the old stacked PR with a comment "Replaced by #<new>".
Why: Leaves one clean history.
Check: New PR merged, old PR closed.
Ack: yes

### 8. Clean up the extra folder
Do: Go back to the repo folder and remove the worktree.
Command: `cd ../AI-Handwriting`
Command: `git worktree remove ../AI-Handwriting-fix`
Why: Removes the second checkout. The folder only contains files already on GitHub, but check that step 7 is finished first.
Danger: yes
Check: `git worktree list` shows only the main folder.
Expect: /^(?!.*AI-Handwriting-fix)/s
Fail-hint: It refuses because of changes? Do not use --force. Paste the message.

## Checks
- New PR base is main, checks green, merged. Old PR closed. Worktree removed. No force push was used.

## Common mistakes
- Using git push --force or git reset --hard to "make the conflict go away".
- Cherry-picking the whole branch including the previous slice's commit.
- Resolving conflicts on the GitHub web page.
- Starting the next prompt before the fix is merged.
- (Prevention) Stacking PRs at all. Branch from main and wait for the merge.
