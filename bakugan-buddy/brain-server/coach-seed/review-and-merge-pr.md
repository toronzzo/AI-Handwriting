---
name: Review and merge a PR
when: ["merge pr", "merge the pull request", "check pr", "review pr", "is the pr ok", "ci passed", "squash and merge", "смержить", "проверить pr", "пулреквест", "мерж", "проверить пр"]
escalate_if: ["a check fails with an error you do not recognise", "the PR shows conflicts", "the PR base is not main", "the PR changes .env, secrets, model, audio or image files you did not expect", "the number of changed files is much bigger than the prompt's file list"]
risk: danger
version: 1
---
# Review and merge a PR

Goal: be sure a Harness PR is safe, then squash-merge it into main. Merging is hard to undo (you would need a revert PR), so every check comes first. You do the clicking.

GitHub repo: toronzzo/AI-Handwriting. Replace <n> with the PR number.

## Steps

### 1. Open the PR page
Do: Open https://github.com/toronzzo/AI-Handwriting/pull/<n> in the browser.
Why: Everything you need is on this page: base branch, checks, files, conflicts.
Check: You see the PR title and a line like "wants to merge 1 commit into main from harness/...".
Expect: /into\s+main/i
Fail-hint: It says "into" another branch (for example harness/something)? Stop. That is a stacked PR. Read `stacked-pr-conflict-fix`.

### 2. Check the checks
Do: Scroll to the checks box at the bottom of the conversation, or run the command below in Terminal.
Command: `gh pr checks <n>`
Why: CI runs typecheck, lint and tests on GitHub. Red means something is broken.
Check: Every check is green or says pass. If some are pending, wait one minute and look again.
Expect: /all checks (have )?passed|pass\b|✓/i
Bad: /fail|✗|x\s+ci/i
Fail-hint: A check failed? Paste the failing check name and its last lines here. Do not merge. If you do not recognise the error, say "ask DeepSeek" or "ask Grok Bot".

### 3. Look at the files that changed
Do: Open the "Files changed" tab, or run the command below.
Command: `gh pr diff <n> --name-only`
Why: The prompt lists the files it may touch. Anything else needs a reason.
Check: The files match the "FILES" part of the prompt. There is no .env, no secrets/ file, no .gguf or .onnx model, no .wav or .mp3 audio.
Expect: /^(?!.*(\.env|secrets\/|\.gguf|\.onnx|\.wav|\.mp3)).*$/s
Fail-hint: A file you did not expect is in the list? Paste the list here before going on.

### 4. Check that GitHub can merge it
Do: On the PR page, look above the merge button.
Why: Conflicts mean the branch does not fit main any more.
Check: It says "This branch has no conflicts with the base branch" and "Merging can be performed automatically".
Expect: /no conflicts|can be performed automatically/i
Bad: /conflict(s)? must be resolved|has conflicts/i
Fail-hint: Conflicts? Do not try to fix them on GitHub. Use `stacked-pr-conflict-fix`.

### 5. Squash and merge
Do: Click "Squash and merge", keep the title, click "Confirm squash and merge". Terminal alternative: gh pr merge <n> --squash (this deletes nothing unless you add --delete-branch).
Command: `gh pr merge <n> --squash`
Why: Squash keeps main history clean: one commit per slice.
Danger: yes
Check: The PR page shows the purple "Merged" label.
Expect: /merged/i
Fail-hint: Button is grey or says "Merging is blocked"? Paste what the box says.

### 6. Confirm it is on main
Do: Run the command below. It should print MERGED.
Command: `gh pr view <n> --json state,mergedAt`
Why: A double check that the merge really happened before you pull.
Check: The output contains "state":"MERGED".
Expect: /"state"\s*:\s*"MERGED"/
Fail-hint: Not MERGED? Reload the PR page and paste what you see.

### 7. Hand over to the pull routine
Do: Next we run the skill `pull-and-refresh`.
Why: Your Mac still has the old code until you pull.
Check: You are ready to pull.
Ack: yes

## Checks
- Base is main. Checks are green. File list is as expected. No conflicts. State is MERGED.

## Common mistakes
- Merging while a check is still pending.
- Merging a PR whose base is another harness/ branch.
- Clicking "Merge" instead of "Squash and merge".
- Fixing conflicts in the GitHub web editor, which hides what changed.

## Glossary
- PR: a request to put one branch's changes into main.
- CI: the automatic checks GitHub runs on the PR.
- squash: join all commits of the PR into one commit on main.
- base: the branch the PR wants to merge into (should be main).
