/**
 * Сторож review: rules first, the local model only as a tie-breaker.
 * reviewAction never executes anything — it returns a verdict. guardedRun
 * executes only on "allow" or a stored one-time approval for "ask".
 * The model can only make a decision STRICTER, never looser: it answers
 * "yes" only for write-class actions that the rules left "unsure".
 */
import crypto from "node:crypto";
import { decide, kindClass, reviewRules } from "./guardRules.mjs";
import { appendGuardLog } from "./guardLog.mjs";

export const APPROVAL_TTL_MS = 60_000;

/** Stable hash of the action (kind, args, origin, source) for approvals. */
export function hashAction(action) {
  const stable = {
    kind: String(action?.kind || ""),
    args: action?.args ?? null,
    origin: String(action?.origin || "user"),
    source: String(action?.source || ""),
  };
  return crypto.createHash("sha256").update(JSON.stringify(stable)).digest("hex");
}

/** Single-use approval tokens bound to one action, valid for 60 s. */
export function createApprovals({ now = () => Date.now() } = {}) {
  const store = new Map(); // token -> { hash, expiresAt }
  return {
    grant(action) {
      const token = crypto.randomBytes(9).toString("hex");
      store.set(token, { hash: hashAction(action), expiresAt: now() + APPROVAL_TTL_MS });
      return token;
    },
    take(action, token) {
      const entry = store.get(String(token || ""));
      if (!entry) return false;
      store.delete(String(token));
      if (now() > entry.expiresAt) return false;
      return entry.hash === hashAction(action);
    },
  };
}

/** The tie-breaker prompt: strict JSON, under 1500 characters of context. */
export function tieBreakPrompt(action) {
  const args = action?.args && typeof action.args === "object" ? JSON.stringify(action.args).slice(0, 400) : "";
  const request = String(action?.userRequest || "").slice(0, 700);
  return [
    'You check whether a tool action matches what the user asked. Reply with one JSON object and nothing else:',
    '{"match":"yes|no|unsure","why":"at most 12 words"}',
    "",
    `User request: ${request}`,
    `Tool action: ${String(action?.kind || "")} ${args}`,
  ].join("\n");
}

/** A judge that asks the local llama (temperature 0, thinking off, 6 s). */
export function llamaJudge({ llamaUrl, fetchImpl = fetch } = {}) {
  return async (action) => {
    if (!llamaUrl) return "unsure";
    try {
      const res = await fetchImpl(`${llamaUrl}/v1/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: "preyas",
          stream: false,
          temperature: 0,
          max_tokens: 40,
          chat_template_kwargs: { enable_thinking: false },
          messages: [
            { role: "system", content: "You are a strict safety checker. Answer JSON only." },
            { role: "user", content: tieBreakPrompt(action) },
          ],
        }),
        signal: AbortSignal.timeout(6_000),
      });
      if (!res.ok) return "unsure";
      const json = await res.json();
      const content = String(json?.choices?.[0]?.message?.content || "");
      const match = content.match(/\{\s*"match"\s*:\s*"(yes|no|unsure)"\s*(?:,"why"\s*:\s*"[^"]*")?\s*\}/i);
      return match ? match[1].toLowerCase() : "unsure";
    } catch {
      return "unsure";
    }
  };
}

/**
 * reviewAction(action, deps) -> { verdict: "allow" | "ask" | "block",
 * rule, why, needsConfirm, model }.
 * deps: { dataDir, fsRoot, allowPaid, judge, now, log }. The audit line is
 * written when dataDir is set; a log failure never changes the verdict.
 * The model tie-breaker runs ONLY on "unsure" and only for write-class
 * actions: yes -> allow, anything else (no/unsure/junk/timeout/no llama) ->
 * ask. Destructive, paid and control actions never reach the model.
 */
export async function reviewAction(action, deps = {}) {
  const findings = reviewRules(action, deps);
  let verdict = decide(findings);
  let rule = verdict.id;
  let why = verdict.why;
  let model = false;

  if (verdict.verdict === "unsure") {
    const cls = kindClass(String(action?.kind || ""));
    if (cls === "write" && typeof deps.judge === "function") {
      model = true;
      try {
        const answer = await deps.judge(action);
        if (answer === "yes") {
          verdict = { verdict: "allow", why: "the model checked it and the request fits" };
          rule = "R6+model";
        } else {
          verdict = { verdict: "ask", why: "the model is not sure this matches your request" };
          rule = "R6+model";
        }
      } catch {
        verdict = { verdict: "ask", why: "the model is not available, so this needs your confirmation" };
        rule = "R6+model";
      }
    } else if (cls === "write") {
      verdict = { verdict: "ask", why: "no model is available, so this needs your confirmation" };
      rule = "R6";
    } else {
      verdict = { verdict: "ask", why: "the rules were not sure, so this needs your confirmation" };
      rule = verdict.id || "R6";
    }
    why = verdict.why;
  }

  const result = {
    verdict: verdict.verdict,
    rule,
    why,
    needsConfirm: verdict.verdict === "ask",
    model,
  };

  if (deps.dataDir) {
    try {
      appendGuardLog(deps.dataDir, {
        v: 1,
        ts: typeof deps.now === "function" ? deps.now() : Date.now(),
        kind: String(action?.kind || ""),
        source: String(action?.source || ""),
        verdict: result.verdict,
        rule: result.rule,
        why: result.why,
        argsPreview: JSON.stringify(action?.args ?? {}),
        model: result.model,
      });
    } catch {
      /* a failing log never changes the verdict */
    }
  }
  return result;
}

/**
 * guardedRun(action, deps, fn) -> { ran, verdict, rule, why, result? }.
 * `fn` runs only on "allow", or on "ask" when deps.approvals has a valid
 * single-use token for exactly this action (action.approvalToken).
 */
export async function guardedRun(action, deps = {}, fn) {
  const review = await reviewAction(action, deps);
  if (review.verdict === "allow") {
    const result = await fn();
    return { ran: true, ...review, result };
  }
  if (review.verdict === "ask" && deps.approvals && typeof deps.approvals.take === "function") {
    if (deps.approvals.take(action, action?.approvalToken)) {
      const result = await fn();
      return { ran: true, ...review, result };
    }
  }
  return { ran: false, ...review };
}
