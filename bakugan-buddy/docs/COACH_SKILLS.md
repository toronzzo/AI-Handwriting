# Coach skills (playbooks)

Coach mode runs from **skill files**: Markdown playbooks that live on the Agent
drive (not in the repo) at `<dataDir>/coach/skills/`. The repo only carries
seed files in `brain-server/coach-seed/`; at brain start-up they are copied
into the skills folder **only when a file with that name does not exist yet**,
so your edits are never overwritten. The seed lessons land as `lessons.jsonl`
only when that file does not exist yet either.

Coach never runs a command. It shows one step at a time and checks what you
paste back. The only commands it can ever print come from `Command:` lines in
the skill files, character for character.

## File format

Each file starts with a tiny frontmatter between `---` lines (plain JSON lists,
no YAML library):

```
---
name: Review and merge a PR
when: ["merge pr", "проверить pr"]
escalate_if: ["the PR shows conflicts"]
risk: low | danger
version: 1
---
```

Then the body, in this order:

- An intro paragraph (anything before `## Steps`) — used for retrieval.
- `## Steps` — one `### N. Title` block per step. Inside a step, one field per
  line (continuation lines append to the last field):
  - `Do:` what the user does. Required.
  - `Why:` one short reason. Required for clarity, omitted in "short" mode.
  - `Command:` a command shown verbatim. Repeatable. Only these ever get
    printed as commands.
  - `Check:` what the user looks at to know the step worked. Required.
  - `Expect:` `/regex/flags` the pasted result must match to advance.
    Repeatable; any one match advances.
  - `Bad:` `/regex/flags` that must NOT match. Checked first; a match never
    advances and counts toward escalation. Repeatable.
  - `Fail-hint:` shown when the result does not pass.
  - `Ack: yes` — the step advances when the user says "done"/"готово"/"ok".
  - `Danger: yes` — rendered with "Careful:", cannot be skipped.
- `## Checks` — `- ` lines, the final definition of done.
- `## Common mistakes` — `- ` lines, shown nowhere automatically but kept with
  the skill for the coach.
- `## Glossary` — `- term: meaning` lines.

Placeholders like `<n>` or `<repo>` are kept as they are; the coach adds
"Replace `<n>` with the real value." when a step contains them.

A step with `Check:` but no `Expect:`/`Bad:` is judged by the local model
(verdict `ok | bad | unsure`); "unsure" never advances. Two `Bad` results or
three no-match/unsure results on the same step escalate to "ask DeepSeek /
ask Grok Bot / save lesson" instead of inventing a command.

## Trigger words and retrieval

`when` phrases are the strongest trigger: a phrase contained in your message
selects the skill. Otherwise BM25 over name + `when` phrases (weighted) + the
intro paragraph. A weak match asks "Say yes to start" first.

Say `coach <topic>` to start, `coach` to resume, `stop` / `back` / `skip` /
`why` / `where am I` any time, `coach skills` for the list, `what have I
learned` for progress, and `save lesson` to teach the coach a new lesson
(situation, cause, fix — stored in `<dataDir>/coach/lessons.jsonl`, append
only, secrets redacted).

## Learning

`<dataDir>/coach/learned.json` counts completions per skill. After two
completions a skill is "learned" and its steps render without the `Why` lines
(asking "why" still shows them). Past lessons are searched before the first
step of a skill and after every Bad result, and the top hit is shown as
"I remember a lesson from <date>: …".

## Writing a new skill

Put the `.md` file in `<dataDir>/coach/skills/` — it is picked up immediately
(mtime cache, no restart). Run `node --experimental-strip-types --test
bakugan-buddy/brain-server/lib/coach/skills.test.mjs` style checks locally, or
ask the coach to try it. Keep `when` phrases short, exact and bilingual
(English + Russian) so retrieval stays reliable.
