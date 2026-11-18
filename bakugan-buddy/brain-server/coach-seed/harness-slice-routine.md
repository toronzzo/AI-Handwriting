---
name: Harness slice routine
when: ["paste harness prompt", "next slice", "run a slice", "start harness", "next prompt", "harness prompt", "вставить промпт", "следующий слайс", "запустить харнес", "следующий промпт"]
escalate_if: ["Harness stops before it prints a final report", "the report says tests failed", "Harness changed files the prompt did not name", "Harness asks you for a password or key"]
risk: low
version: 1
---
# Harness slice routine

One slice = one Harness prompt = one PR. The whole loop is: paste the prompt, read the report, check the PR and CI, merge, pull, refresh. This skill covers the first half (paste and read). Then it hands over to `review-and-merge-pr` and `pull-and-refresh`.

## Steps

### 1. Make sure the last slice is finished
Do: Check that the previous slice's PR is merged into main and that you pulled it. If there is no previous slice (this is the first one), go on.
Why: Every prompt starts from the latest main. If the old PR is not merged yet, the new branch will not contain its work, and later merges clash.
Check: The previous PR page says "Merged" (purple), or you are starting slice 1.
Expect: /merged|first slice|no previous/i
Fail-hint: Not merged yet? Stop here and run the skill `review-and-merge-pr` first, then `pull-and-refresh`.

### 2. Open a fresh Harness chat
Do: Open DeepSeek Harness on the Mac, in the AI-Handwriting repo folder. Start a NEW chat for this prompt. Use the normal model setting. Use Pro high only if the plan says so for that slice.
Why: A fresh chat is cheaper and Harness does not get confused by the previous work. Each prompt starts by reading handoff.md, so no context is lost.
Check: You see an empty chat in the AI-Handwriting folder.
Ack: yes

### 3. Paste the prompt exactly as written
Do: Copy the whole code block of the prompt from the plan file and paste it. Do not add or remove lines.
Why: The prompt begins with "First read /Volumes/Agent/agent/notes/handoff.md for context." and a rules block. Those rules keep Harness away from main, secrets and your drive.
Check: The first line of what you pasted is: First read /Volumes/Agent/agent/notes/handoff.md for context.
Expect: /First read \/Volumes\/Agent\/agent\/notes\/handoff\.md/
Fail-hint: The first line is different or the rules block is missing? Paste again from the plan file. Do not start a run with a partial prompt.

### 4. Wait for the final report
Do: Let Harness work. Do not close the window and do not start another prompt. When it stops, scroll to its last message, the final report.
Why: Two runs at the same time can fight over the same files and the same ports.
Check: The last message lists what changed, a PR link, and the typecheck and test result.
Expect: /github\.com\/toronzzo\/AI-Handwriting\/pull\/\d+/
Bad: /could not|failed|error|stuck/i
Fail-hint: No PR link means the run did not finish. Do not paste the next prompt. Paste the last 20 lines of Harness here so we can look at them.

### 5. Read the report
Do: Read the report in the Harness window. Note the PR number, the branch name (it should be harness/<slice name>), and whether it says typecheck and tests passed. Note anything it says it could not check.
Why: This is your first quality check, before you look at GitHub.
Check: Branch starts with harness/, tests passed, and the "could not check" part is small or empty.
Expect: /harness\/[a-z0-9-]+/
Fail-hint: Branch is not harness/<name>, or tests failed? Paste the report here before going on.

### 6. Hand over to the merge routine
Do: Tell me the PR number. Then we run the skill `review-and-merge-pr`.
Why: Do not paste the next prompt until this PR is merged and pulled.
Check: You told me the PR number.
Expect: /\d+/

## Checks
- One Harness run at a time.
- The PR number is known and the branch is harness/<name>.
- The next prompt is not pasted before the merge.

## Common mistakes
- Pasting the next prompt while the previous PR is still open (this caused the stacked-PR conflicts, see `stacked-pr-conflict-fix`).
- Adding your own line at the top of the prompt, for example a base-branch line. Branching is already in the rules.
- Reusing an old chat, so Harness mixes two tasks.
- Closing the Harness window before the final report.
