/**
 * The one place a Harness prompt is assembled.
 *
 * The header and the RULES are added by code, never by the local model: the
 * model only writes the TASK body (max TASK_MAX characters), so no goal text can
 * remove a rule. HEADER_LINE is always the first line and RULES is always the
 * second block. The branch name is `harness/<slug>` where the slug is the
 * lowercase kebab of the goal (max 30 characters) plus a short time stamp.
 */

export const HEADER_LINE = "First read /Volumes/Agent/agent/notes/handoff.md for context.";

/** The model writes only this much of the prompt. */
export const TASK_MAX = 1800;

/**
 * The standard rules block. `<slug>` is replaced with the real slug by
 * buildPrompt; keep the text identical to the plan so every prompt carries the
 * same promises.
 */
export const RULES = [
  "RULES (obey all):",
  "- No subagents.",
  "- Work only on your own branch harness/<slug>. Push only that branch, then open a PR to main with gh. Never merge, never force-push, never push to main.",
  "- Never delete or move anything in /Volumes/Agent.",
  "- Never touch secrets/.env.",
  "- Do not commit model weights, audio or secrets.",
  "- Leave ports 8790, 8788, 8081 and 4000 running. Do not stop, restart or kill them.",
  "- Do not copy Notion, Pinterest or Mitsubishi art or logos. Use only the colours, sizes and layout written in the task.",
  "- Run typecheck and tests before the PR; fix every failure; do not skip or weaken tests.",
  "- Final report in simple English: what changed, PR link, test result.",
].join("\n");

/** Fill the real branch into the rules block. */
export function rulesFor(slug) {
  return RULES.replace("<slug>", String(slug ?? ""));
}

/**
 * The lines of the standard rules, as patterns that match the rendered block.
 * `lintPrompt` removes these lines before looking for instructions that try to
 * smuggle the same words into a task body; the rules themselves are code-added
 * and harmless, and a hostile task cannot hide anything inside an exact copy of
 * a safe line.
 */
const SAFE_LINE = [
  /^RULES \(obey all\):$/,
  /^- No subagents\.$/,
  /^- Work only on your own branch harness\/[a-z0-9-]+\. Push only that branch, then open a PR to main with gh\. Never merge, never force-push, never push to main\.$/,
  /^- Never delete or move anything in \/Volumes\/Agent\.$/,
  /^- Never touch secrets\/\.env\.$/,
  /^- Do not commit model weights, audio or secrets\.$/,
  /^- Leave ports 8790, 8788, 8081 and 4000 running\. Do not stop, restart or kill them\.$/,
  /^- Do not copy Notion, Pinterest or Mitsubishi art or logos\. Use only the colours, sizes and layout written in the task\.$/,
  /^- Run typecheck and tests before the PR; fix every failure; do not skip or weaken tests\.$/,
  /^- Final report in simple English: what changed, PR link, test result\.$/,
];

/** Remove the standard rules lines from a prompt so a task body can be scanned. */
export function stripStandardRules(text) {
  return String(text ?? "")
    .split("\n")
    .filter((line) => !SAFE_LINE.some((pattern) => pattern.test(line.trim())))
    .join("\n");
}

/** Lowercase kebab of the goal, at most `max` characters. */
export function kebab(text, max = 30) {
  const base = String(text ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, Math.max(0, max))
    .replace(/-+$/g, "");
  return base || "task";
}

/** The short time stamp: UTC to the minute, no separators (for example 20261119t1850). */
export function stampFor(now = Date.now()) {
  return new Date(now).toISOString().slice(0, 16).replace(/[-:]/g, "").replace("T", "t");
}

/** The branch slug: kebab of the goal (max 30 chars) plus a short time stamp. */
export function slugFor(goalText, now = Date.now()) {
  return `${kebab(goalText, 30)}-${stampFor(now)}`;
}

/**
 * buildPrompt({ goalText, slug, now }) -> the complete prompt text.
 * Always: HEADER_LINE first, the RULES second, then the branch line and TASK.
 */
export function buildPrompt({ goalText, slug, now = Date.now() } = {}) {
  const task = String(goalText ?? "").trim().slice(0, TASK_MAX);
  const branchSlug = kebab(slug || slugFor(task, now), 80).slice(0, 80);
  return [
    HEADER_LINE,
    "",
    rulesFor(branchSlug),
    "",
    `Branch: harness/${branchSlug}`,
    "",
    "TASK:",
    task,
  ].join("\n");
}

/** The local model is only asked to write the task body; never the paid route. */
export const DRAFT_SYSTEM_PROMPT =
  "write a tight, precise coding task: goal, exact files if known, acceptance checks; no preamble";

/** Last resort when the local model is down: the user's own words. */
export function fallbackTask(goal) {
  return String(goal ?? "").trim().slice(0, TASK_MAX);
}

/**
 * draftTask(llamaUrl, goal) asks the local llama for the TASK body. Any failure
 * (down, timeout, empty answer) falls back to the user's own words. Never the
 * paid gateway, never a network retry beyond the one request.
 */
export async function draftTask(
  llamaUrl,
  goal,
  { fetchImpl = fetch, timeoutMs = 20_000, systemPrompt = DRAFT_SYSTEM_PROMPT } = {},
) {
  const fallback = fallbackTask(goal);
  if (!llamaUrl || !fallback) return fallback;
  try {
    const response = await fetchImpl(`${String(llamaUrl).replace(/\/$/, "")}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "preyas",
        stream: false,
        temperature: 0.2,
        max_tokens: 700,
        chat_template_kwargs: { enable_thinking: false },
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: fallback },
        ],
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) return fallback;
    const json = await response.json();
    const raw = String(json?.choices?.[0]?.message?.content || "").trim();
    const cleaned = raw
      .replace(/^```[a-zA-Z]*\s*/, "")
      .replace(/```\s*$/, "")
      .trim();
    return cleaned ? cleaned.slice(0, TASK_MAX) : fallback;
  } catch {
    return fallback;
  }
}
