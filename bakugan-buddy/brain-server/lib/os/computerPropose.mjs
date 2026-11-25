/**
 * B6 computer control: the Proposer. The model reads a TEXT summary of the
 * frontmost window (element id, role, label, position from the macOS
 * accessibility tree) — never a screenshot. It proposes ONE next step, the
 * session checks it against the deny list, and the user approves with Да/Нет.
 *
 * IMPORTANT LIMIT: Preyas's local model (Qwen3 8B) and DeepSeek flash are
 * TEXT-ONLY. The screenshot exists only for the human. A vision model can be
 * plugged in later behind the same Proposer interface.
 */
import { redactSecrets } from "../coach/redact.mjs";

export const PROPOSE_ACTIONS = ["click", "type", "key", "done", "ask"];
export const PROPOSER_TIMEOUT_MS = 20_000;
export const PROPOSER_CONTEXT_MAX = 3000;
export const PROPOSER_MAX_TOKENS = 120;
export const PAID_PROPOSER_TIMEOUT_MS = 30_000;

const RULES_LINE = [
  "Never give coordinates: a click names an element id from the list.",
  "Type at most 300 characters, never with a newline.",
  "Never press quit combos, never delete, erase, pay, buy or transfer, never type sudo or rm.",
  "When unsure, answer ask.",
].join(" ");

/**
 * The exact prompt the model sees. Under 3000 characters of context:
 * the goal, a compact element list and the last actions.
 */
export function buildProposePrompt({ goal, snapshot, lastActions }) {
  const lines = ["You propose ONE next step on the Mac for this goal. " + RULES_LINE, ""];
  lines.push(`Goal: ${String(goal || "").slice(0, 400)}`);
  lines.push("Reply with one JSON object and nothing else:");
  lines.push('{"action":"click","target":"<element id>","why":"at most 15 words"}');
  lines.push('{"action":"type","text":"<text>","why":"..."}');
  lines.push('{"action":"key","combo":"cmd+c","why":"..."}');
  lines.push('{"action":"done","why":"..."} for a finished goal, {"action":"ask","why":"..."} when you need more.');
  lines.push("");
  lines.push("Elements (id role \"label\"):");
  const elements = (snapshot?.elements ?? []).slice(0, 40);
  for (const el of elements) {
    lines.push(`${el.id} ${el.role} "${el.label}"`);
  }
  if (!elements.length) lines.push("(no elements)");
  const acts = Array.isArray(lastActions) ? lastActions.slice(-5) : [];
  if (acts.length) {
    lines.push("");
    lines.push("Last actions:");
    for (const act of acts) lines.push(String(act).slice(0, 120));
  }
  return lines.join("\n").slice(0, PROPOSER_CONTEXT_MAX);
}

/**
 * Strict parse of a model reply. Returns { ok:true, proposal } or
 * { ok:false, reason }. A click must name an element id from THIS snapshot;
 * the centre of that element is taken from the snapshot, never from the
 * model, and coordinates in the reply are refused outright.
 */
export function parseProposal(text, snapshot) {
  if (typeof text !== "string") return { ok: false, reason: "bad_json" };
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return { ok: false, reason: "bad_json" };
  let obj;
  try {
    obj = JSON.parse(match[0]);
  } catch {
    return { ok: false, reason: "bad_json" };
  }
  if (!obj || typeof obj !== "object") return { ok: false, reason: "bad_json" };
  if (obj.x !== undefined || obj.y !== undefined || obj.coordinates !== undefined) {
    return { ok: false, reason: "coordinates" };
  }
  const action = String(obj.action || "").toLowerCase();
  if (!PROPOSE_ACTIONS.includes(action)) return { ok: false, reason: "unknown_action" };
  const why = String(obj.why || "").slice(0, 300);
  if (action === "click") {
    const target = String(obj.target || "");
    const elements = Array.isArray(snapshot?.elements) ? snapshot.elements : [];
    const el = elements.find((row) => String(row.id) === target);
    if (!el) return { ok: false, reason: "unknown_element" };
    return {
      ok: true,
      proposal: {
        action,
        target,
        targetLabel: String(el.label || ""),
        why,
        center: { x: Number(el.x) + Number(el.w) / 2, y: Number(el.y) + Number(el.h) / 2 },
      },
    };
  }
  if (action === "type") {
    const text = String(obj.text ?? "");
    if (!text) return { ok: false, reason: "bad_json" };
    return { ok: true, proposal: { action, text, why } };
  }
  if (action === "key") {
    const combo = String(obj.combo ?? "");
    if (!combo) return { ok: false, reason: "bad_json" };
    return { ok: true, proposal: { action, combo, why } };
  }
  return { ok: true, proposal: { action, why } };
}

/**
 * The default proposer: the LOCAL llama through an injected `complete`
 * function (temperature 0, thinking off, strict JSON, 20 s timeout).
 * Bad JSON or a timeout becomes { action: "ask", why: "I could not decide" }.
 */
export function createLlamaProposer({ complete, timeoutMs = PROPOSER_TIMEOUT_MS } = {}) {
  return {
    async propose({ goal, snapshot, lastActions }) {
      const prompt = buildProposePrompt({ goal, snapshot, lastActions });
      let raw = "";
      try {
        raw = String(await Promise.race([
          complete({ prompt }),
          new Promise((_, reject) => {
            const timer = setTimeout(() => reject(new Error("proposer timeout")), timeoutMs);
            if (typeof timer.unref === "function") timer.unref();
          }),
        ]));
      } catch {
        return { action: "ask", why: "I could not decide", reason: "timeout" };
      }
      const parsed = parseProposal(raw, snapshot);
      if (!parsed.ok) {
        return { action: "ask", why: "I could not decide", reason: parsed.reason };
      }
      return parsed.proposal;
    },
  };
}

/** fetch-based `complete` for the local llama-server. */
export function createLocalProposer({ llamaUrl, fetchImpl = fetch, model = "preyas" } = {}) {
  const url = String(llamaUrl || process.env.LLAMA_URL || "http://127.0.0.1:8790").replace(/\/$/, "");
  return createLlamaProposer({
    complete: async ({ prompt }) => {
      const res = await fetchImpl(`${url}/v1/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model,
          stream: false,
          temperature: 0,
          max_tokens: PROPOSER_MAX_TOKENS,
          chat_template_kwargs: { enable_thinking: false },
          messages: [
            { role: "system", content: "You are a careful macOS assistant. Reply with one JSON object and nothing else." },
            { role: "user", content: prompt },
          ],
        }),
        signal: AbortSignal.timeout(PROPOSER_TIMEOUT_MS),
      });
      if (!res.ok) throw new Error("llama unavailable");
      const json = await res.json();
      return String(json?.choices?.[0]?.message?.content || "");
    },
  });
}

/**
 * The escalation proposer: the SAME prompt sent to the paid gateway. It only
 * runs after the user's Да and the daily spend gate. Returns the raw reply
 * text; the session parses it against the same snapshot rules.
 */
export function createPaidProposer({ paidUrl, fetchImpl = fetch, model = "paid" } = {}) {
  const url = String(paidUrl || process.env.PAID_GATEWAY_URL || "http://127.0.0.1:4000").replace(/\/$/, "");
  return async ({ prompt }) => {
    const res = await fetchImpl(`${url}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model,
        stream: false,
        temperature: 0,
        max_tokens: PROPOSER_MAX_TOKENS,
        messages: [
          { role: "system", content: "You are a careful macOS assistant. Reply with one JSON object and nothing else." },
          { role: "user", content: prompt },
        ],
      }),
      signal: AbortSignal.timeout(PAID_PROPOSER_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error("paid gateway unavailable");
    const json = await res.json();
    // The usage the gateway reported travels with the text so the session can
    // settle the shared daily ledger once, from what the provider measured
    // rather than from an estimate the caller made up.
    return {
      text: String(json?.choices?.[0]?.message?.content || ""),
      usage: json && typeof json.usage === "object" ? json.usage : null,
    };
  };
}

/**
 * The EXACT text that would leave the machine for the paid hand-off,
 * redacted and shown to the user BEFORE the Да/Нет. Screenshots are NEVER
 * sent — the prompt is text only.
 */
export function buildEscalationPrompt({ goal, snapshot, lastActions }) {
  return redactSecrets(buildProposePrompt({ goal, snapshot, lastActions }));
}
