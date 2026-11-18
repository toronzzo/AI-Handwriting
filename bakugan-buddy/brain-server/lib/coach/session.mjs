/**
 * Coach session: a pure state machine. No I/O, no timers beyond `now()`.
 * Exactly one step is shown per reply, and a step only advances on a good
 * match — never on a Bad match, a no-match, or an "unsure" judge.
 */

export const BAD_LIMIT = 2;
export const UNSURE_LIMIT = 3;

const STOP_WORDS = new Set(["stop", "стоп", "stop coach", "стоп коуч"]);
const BACK_WORDS = new Set(["back", "назад"]);
const SKIP_WORDS = new Set(["skip", "пропустить", "пропусти"]);
const WHY_WORDS = new Set(["why", "почему", "зачем"]);
const WHERE_WORDS = new Set(["where am i", "где я"]);
const DONE_WORDS = new Set(["done", "готово", "ok", "дальше", "next"]);

export function beginSession(skill, now = () => Date.now()) {
  return {
    mode: "skill",
    skillName: skill.name,
    step: 1,
    attempts: { bad: 0, unsure: 0 },
    startedAt: now(),
    lastSnippet: "",
    userWhy: false,
    prevAfterLesson: null,
  };
}

export function sessionView(session, skill) {
  if (!session || session.mode !== "skill") return { mode: session ? session.mode : "off" };
  return {
    mode: "skill",
    skillName: session.skillName,
    step: session.step,
    of: skill ? skill.steps.length : 0,
    startedAt: session.startedAt,
  };
}

function matchesAny(regexes, text) {
  return regexes.some((entry) => entry.re && entry.re.test(text));
}

function advance(session, skill, snippet) {
  session.step += 1;
  session.attempts = { bad: 0, unsure: 0 };
  session.userWhy = false;
  if (snippet !== undefined) session.lastSnippet = snippet;
  if (session.step > skill.steps.length) {
    session.mode = "off";
    return "finished";
  }
  return "ok_next";
}

function escalateOn(session, kind) {
  if (session.attempts[kind] >= (kind === "bad" ? BAD_LIMIT : UNSURE_LIMIT)) return "escalate";
  return "retry";
}

/**
 * One user turn inside a running session. `judge(step, snippet)` resolves to
 * "ok" | "bad" | "unsure" and is only called for steps with a Check but no
 * Expect/Bad patterns. Returns { session, action } where action.kind is one of
 * show_step | ok_next | retry | finished | escalate | info | why.
 */
export async function handleSession(session, skill, rawText, judge) {
  const text = String(rawText ?? "").replace(/\s+/g, " ").trim();
  const word = text.toLowerCase();

  if (STOP_WORDS.has(word)) {
    session.mode = "off";
    return { session, action: { kind: "info", text: "Coach stopped. Say \"coach\" to start a new one." } };
  }
  if (WHERE_WORDS.has(word)) {
    return { session, action: { kind: "info", text: `You are in ${session.skillName}, step ${session.step} of ${skill.steps.length}.` } };
  }
  if (WHY_WORDS.has(word)) {
    session.userWhy = true;
    return { session, action: { kind: "why" } };
  }
  if (BACK_WORDS.has(word)) {
    session.step = Math.max(1, session.step - 1);
    session.attempts = { bad: 0, unsure: 0 };
    return { session, action: { kind: "show_step" } };
  }
  if (SKIP_WORDS.has(word)) {
    const step = skill.steps[session.step - 1];
    if (step?.danger) {
      return { session, action: { kind: "info", text: "This step is marked Danger and cannot be skipped. Do it and paste the result." } };
    }
    return { session, action: { kind: advance(session, skill) } };
  }

  const step = skill.steps[session.step - 1];
  if (!step) {
    session.mode = "off";
    return { session, action: { kind: "finished" } };
  }

  const ackWord = step.ack && DONE_WORDS.has(word);
  if (!ackWord && (BACK_WORDS.has(word) || SKIP_WORDS.has(word) || WHY_WORDS.has(word))) {
    return handleSession(session, skill, word, judge); // unreachable; words handled above
  }

  // A step with `Ack: yes` advances on a done-word, whatever else it has.
  if (ackWord) {
    return { session, action: { kind: advance(session, skill) } };
  }

  const snippet = String(text).slice(0, 200);

  if (step.bads.length && matchesAny(step.bads, text)) {
    session.attempts.bad += 1;
    session.lastSnippet = snippet;
    return { session, action: { kind: escalateOn(session, "bad"), reason: "bad" } };
  }

  if (step.expects.length) {
    if (matchesAny(step.expects, text)) {
      return { session, action: { kind: advance(session, skill, snippet) } };
    }
    session.attempts.unsure += 1;
    session.lastSnippet = snippet;
    return { session, action: { kind: escalateOn(session, "unsure"), reason: "no-match" } };
  }

  // No patterns: the judge decides.
  const verdict = await judge(step, snippet);
  if (verdict === "ok") {
    return { session, action: { kind: advance(session, skill, snippet) } };
  }
  const kind = verdict === "bad" ? "bad" : "unsure";
  session.attempts[kind] += 1;
  session.lastSnippet = snippet;
  return { session, action: { kind: escalateOn(session, kind), reason: kind === "bad" ? "bad" : "unsure" } };
}
