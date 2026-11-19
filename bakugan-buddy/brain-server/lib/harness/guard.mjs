/**
 * The Harness guard: pure decisions, no I/O.
 *
 * Money is the point of this file. A run can start only when the draft came
 * from the user's Generate button, is fresh and unused, no other run is active,
 * a real price was configured and today's spend plus the worst-case estimate
 * stays under the one daily cap. Everything fails closed.
 */
import crypto from "node:crypto";
import { redactSecrets } from "../activity.mjs";
import { PRICE_MISSING_MESSAGE } from "./estimate.mjs";
import { stripStandardRules } from "./promptTemplate.mjs";

/** A draft older than this may not start. */
export const DRAFT_TTL_MS = 10 * 60 * 1000;

const no = (code, reason) => ({ ok: false, code, reason });

/** sha256 of the exact prompt, carried by the draft and checked by approve(). */
export function hashPrompt(text) {
  return crypto.createHash("sha256").update(String(text ?? "")).digest("hex");
}

/**
 * canStart({ draft, now, runActive, spentTodayUsd, capUsd, estimate }) ->
 *   { ok: true } | { ok: false, code, reason }
 *
 * The order is deliberate: a missing or used draft is answered before the
 * budget, so the app can show the exact next thing the user must do.
 */
export function canStart({
  draft = null,
  now = Date.now(),
  runActive = false,
  spentTodayUsd = 0,
  capUsd = 0,
  estimate = null,
} = {}) {
  if (!draft) return no("NO_DRAFT", "Draft a prompt first, then press Да.");
  if (draft.used) return no("DRAFT_USED", "This draft was already used. Draft a new prompt.");
  const created = Number(draft.createdAt);
  if (!Number.isFinite(created) || Number(now) - created > DRAFT_TTL_MS) {
    return no("DRAFT_EXPIRED", "This draft is older than 10 minutes. Draft it again.");
  }
  if (draft.startedBy !== "user-button") {
    return no("NOT_USER_STARTED", "A run starts only from the Generate button.");
  }
  if (runActive) return no("RUN_ACTIVE", "Harness is already running. Stop it first.");
  const high = Number(estimate?.usdHigh);
  if (!estimate || !Number.isFinite(high)) return no("NO_PRICE", PRICE_MISSING_MESSAGE);

  const spent = Number(spentTodayUsd);
  const cap = Number(capUsd);
  const safeSpent = Number.isFinite(spent) && spent > 0 ? spent : 0;
  const safeCap = Number.isFinite(cap) && cap > 0 ? cap : 0;
  // spent + high > cap also covers "spent is already above a lowered cap".
  if (safeSpent + high > safeCap) {
    return no(
      "OVER_CAP",
      `Today is already $${safeSpent.toFixed(2)} of $${safeCap.toFixed(2)}, and this run could cost up to $${high.toFixed(2)}.`,
    );
  }
  return { ok: true };
}

/**
 * Patterns that must never reach Harness. Every plan this repo can build says
 * these are forbidden, so a draft that asks for one is refused before a process
 * is spawned. `guard.mjs` is allowed to name them; the rest of lib/harness may
 * not contain their command spellings.
 */
const FORBIDDEN = [
  { code: "PUSH_MAIN", pattern: /git\s+push\b[^\n]*(?:\bmain\b|\bmaster\b)/i, why: "a push to main or master" },
  { code: "FORCE", pattern: /--force\b/i, why: "--force" },
  { code: "PUSH_FORCE_SHORT", pattern: /git\s+push\b[^\n]*(?:\s-f\b|\s-f\s)/i, why: "a forced push" },
  { code: "PR_MERGE", pattern: /gh\s+pr\s+merge\b/i, why: "a pull request merge" },
  { code: "RESET_HARD", pattern: /reset\s+--hard\b/i, why: "a hard reset" },
  { code: "RM_RF", pattern: /(?:^|\s)rm\s+-[a-z]*r[a-z]*f[a-z]*\b/i, why: "removing a tree" },
  { code: "SECRETS_ENV", pattern: /secrets\/\.env/i, why: "reading the secrets file", taskOnly: true },
  {
    code: "AGENT_DELETE",
    pattern: /\/Volumes\/Agent[\s\S]{0,80}?\b(?:delete|remove|move|rename|trash|erase|wipe|rm)\b/i,
    why: "deleting or moving something on the Agent drive",
    taskOnly: true,
  },
];

/**
 * lintPrompt(text) -> { ok: true } | { ok: false, code, reason }
 *
 * The standard rules block is code-added, so its own "never touch
 * secrets/.env" and "never delete or move anything in /Volumes/Agent" lines are
 * removed before the task body is checked.
 */
export function lintPrompt(text) {
  const source = String(text ?? "");
  if (!source.trim()) return no("EMPTY", "The draft is empty.");
  const task = stripStandardRules(source);
  for (const rule of FORBIDDEN) {
    const target = rule.taskOnly ? task : source;
    if (rule.pattern.test(target)) {
      return no(rule.code, `The draft asks for ${rule.why}, which is not allowed. Draft a safer task.`);
    }
  }
  return { ok: true };
}

/**
 * redact(text, secretValues) hides every secret value of 6+ characters behind
 * `***`, after the shared `sk-` / Bearer / KEY= heuristics from activity.mjs.
 */
export function redact(text, secretValues = []) {
  let out = redactSecrets(String(text ?? ""));
  const values = Array.isArray(secretValues) ? secretValues : [];
  for (const item of values) {
    const value = String(item ?? "");
    if (value.length >= 6) out = out.split(value).join("***");
  }
  return out;
}
