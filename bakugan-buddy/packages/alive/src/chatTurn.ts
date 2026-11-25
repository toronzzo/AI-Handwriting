/**
 * Shared chat turns for Preyas and an optional paid model.
 * History is trimmed before it reaches the 16K llama context on a 16 GB Mac.
 * The full log stays on the Agent drive; only the summary and newest turns go out.
 */

import { PREYAS_CHAT_PERSONA, validatePersona } from "./persona.ts";

export const CHAT_MAX_TOKENS = 512;
/** Thinking spends tokens before the answer, so it needs a much larger cap. */
export const THINK_MAX_TOKENS = 2048;
/** Paid flash can spend a short cap on reasoning and return an empty answer. */
export const PAID_MAX_TOKENS = 2048;
/** Input budget: recent turns only; notes and the rolling summary carry the rest. */
export const HISTORY_TOKEN_BUDGET = 2400;
/** A 512-token local answer can legitimately take most of a minute on an M1. */
export const LOCAL_TIMEOUT_MS = 60_000;

/** The persona the live drive file can override at runtime. Same name as before. */
export const PREYAS_CHAT_SYSTEM = PREYAS_CHAT_PERSONA;

let chatSystemOverride: string | null = null;
let chatExtras: ((userText: string) => string) | null = null;

/** The persona in effect: the live drive persona when set, else the default. */
export function getChatSystem(): string {
  return chatSystemOverride ?? PREYAS_CHAT_PERSONA;
}

/**
 * Swaps in a live persona (from the drive). Anything validatePersona refuses
 * is rejected and the current persona stays; null restores the default.
 */
export function setChatSystem(text: string | null): boolean {
  if (text === null) {
    chatSystemOverride = null;
    return true;
  }
  if (!validatePersona(text).ok) return false;
  chatSystemOverride = text;
  return true;
}

/**
 * Extra system lines for one request (slice B5: gold examples). The result is
 * appended after the summary; an empty string adds nothing and any throw is
 * swallowed. Pass null to unregister.
 */
export function registerChatExtras(fn: ((userText: string) => string) | null): void {
  chatExtras = fn;
}

export type ChatRole = "system" | "user" | "assistant";

export type ChatMessage = {
  role: ChatRole;
  content: string;
  who?: "user" | "preyas" | "paid";
  model?: string;
  costUsd?: number | null;
};

export type TokenUsage = {
  prompt_tokens?: number;
  completion_tokens?: number;
};

export function estimateTokens(text: string): number {
  const chars = text.length;
  if (chars <= 0) return 0;
  return Math.max(1, Math.ceil(chars / 4));
}

/** Keep the system lines and the newest turns that fit the budget. */
export function trimHistory(messages: readonly ChatMessage[], budget = HISTORY_TOKEN_BUDGET): ChatMessage[] {
  const system = messages.filter((message) => message.role === "system");
  const rest = messages.filter((message) => message.role !== "system");
  let room = budget;
  for (let i = 0; i < system.length; i++) room -= estimateTokens(system[i]!.content) + 4;
  const kept: ChatMessage[] = [];
  for (let i = rest.length - 1; i >= 0; i--) {
    const cost = estimateTokens(rest[i]!.content) + 4;
    if (kept.length > 0 && cost > room) break;
    if (cost > room) break;
    kept.push(rest[i]!);
    room -= cost;
  }
  kept.reverse();
  return [...system, ...kept];
}

export type RouteChoice = {
  route: "local" | "paid";
  reason: string;
};

export function chooseRoute(input: {
  askPaid: boolean;
  localFailed: boolean;
  paidAvailable: boolean;
  allowPaidOnFailure: boolean;
}): RouteChoice {
  if (input.askPaid) {
    if (!input.paidAvailable) return { route: "local", reason: "paid model is off" };
    return { route: "paid", reason: "you asked" };
  }
  if (input.localFailed && input.allowPaidOnFailure && input.paidAvailable) {
    return { route: "paid", reason: "local brain timed out" };
  }
  return { route: "local", reason: "local first" };
}

/** DeepSeek flash, cache-miss rates. Peak is 2×. Returns null when usage is missing. */
export function estimatePaidCost(usage: TokenUsage | null | undefined, peak = false): number | null {
  if (!usage) return null;
  const prompt = usage.prompt_tokens ?? 0;
  const completion = usage.completion_tokens ?? 0;
  if (prompt <= 0 && completion <= 0) return null;
  const inRate = peak ? 0.3 : 0.15;
  const outRate = peak ? 1.2 : 0.6;
  return (prompt * inRate + completion * outRate) / 1_000_000;
}

/** Weekday 01:00–04:00 and 06:00–10:00 UTC. Ends are off-peak. Weekends are off-peak. */
export function deepseekIsPeak(now: Date): boolean {
  const moment = new Date(now.getTime());
  const day = moment.getUTCDay();
  if (day === 0 || day === 6) return false;
  const minutes = moment.getUTCHours() * 60 + moment.getUTCMinutes();
  return (60 <= minutes && minutes < 4 * 60) || (6 * 60 <= minutes && minutes < 10 * 60);
}

export function paidButton(input: {
  available: boolean;
  offPeakOnly: boolean;
  now: Date;
  downReason?: string;
}): { enabled: boolean; reason: string } {
  if (!input.available) {
    return { enabled: false, reason: input.downReason || "No DeepSeek key on the Agent drive" };
  }
  if (input.offPeakOnly && deepseekIsPeak(input.now)) {
    return { enabled: false, reason: "DeepSeek is at peak price. Try again off-peak." };
  }
  return { enabled: true, reason: "Ask DeepSeek flash" };
}

export function modelId(route: "local" | "paid", via: "gateway" | "proxy"): string {
  if (route === "paid") return "paid";
  return via === "gateway" ? "local" : "preyas";
}

/**
 * Where one chat turn is sent.
 *
 * Always the brain. LiteLLM on :4000 answers /v1/models, but its `local`
 * model calls the brain without the pairing token, so the brain returns 401
 * and the app says Preyas didn't answer. The brain itself forwards model
 * "paid" to that gateway when a key is configured, and local model "preyas"
 * to llama. The browser request still carries the token (or the Mac page's
 * own Origin); nothing here relaxes that check.
 */
export function chatTarget(route: "local" | "paid", brainUrl: string): { base: string; model: string } {
  const base = String(brainUrl || "").replace(/\/$/, "");
  return { base, model: route === "paid" ? "paid" : "preyas" };
}

export function splitPaidHint(text: string): { text: string; suggestPaid: boolean } {
  const suggestPaid = text.includes("[[ASK_PAID]]");
  const cleaned = text.replace(/\[\[ASK_PAID\]\]/g, "").trim();
  return { text: cleaned, suggestPaid };
}

/**
 * Build the request. The rolling summary rides in the system message, so the
 * user turn is exactly what they typed: a bare "yes" then sits directly after
 * the question Preyas asked, instead of being buried under a memory block.
 */
export function toModelMessages(messages: readonly ChatMessage[], summary: string, userText: string): ChatMessage[] {
  const prior = trimHistory(messages.filter((message) => message.role !== "system"));
  const memory = summary.trim();
  const system = getChatSystem();
  let extras = "";
  if (chatExtras) {
    try {
      extras = String(chatExtras(userText) ?? "");
    } catch {
      extras = "";
    }
  }
  const parts = [system];
  if (memory) parts.push(`What you remember from earlier:\n${memory}`);
  if (extras.trim()) parts.push(extras.trim());
  return [
    { role: "system", content: parts.join("\n\n") },
    ...prior.map((message) => ({ role: message.role, content: message.content })),
    { role: "user", content: userText },
  ];
}

export type SsePiece = { text: string; reasoning: string; usage: TokenUsage | null };

export function isPaidModel(model: string): boolean {
  const name = model.toLowerCase();
  return name === "paid" || name.includes("deepseek");
}

/** Local Qwen gets a short cap. Paid DeepSeek thinking is turned off, with room if it still reasons. */
/**
 * Questions worth thinking about: a story, an explanation, maths or logic, or a
 * "why". A greeting or a quick fact stays on the fast path.
 */
export function wantsThinking(raw: string): boolean {
  const text = String(raw ?? "").trim().toLowerCase();
  if (!text) return false;
  if (text.length < 12) return false;
  const hints = [
    /\bexplain\b/,
    /\bwhy\b/,
    /\bstory\b/,
    /\btell me about\b/,
    /\bstep by step\b/,
    /\bprove\b/,
    /\bderive\b/,
    /\bcalculate\b/,
    /\bhow (?:do|does|can|would)\b/,
    /\bwhat if\b/,
    /\bcompare\b/,
    /\bplan\b/,
    /\bwork out\b/,
    /\bsolve\b/,
    /\bmath\b/,
    /\blogic\b/,
    /[0-9]\s*[+\-*/×÷]\s*[0-9]/,
    /\b(?:percent|percentage|average|sum of)\b/,
  ];
  return hints.some((pattern) => pattern.test(text));
}

/** "yes", "ok", "sure", "да" … a bare answer to the question Preyas just asked. */
export function isShortAffirmation(raw: string): boolean {
  const text = String(raw ?? "")
    .trim()
    .toLowerCase()
    .replace(/[.!?。！？]+$/g, "")
    .replace(/\s+/g, " ");
  if (!text || text.length > 24) return false;
  return /^(?:yes|yeah|yep|yup|sure|ok|okay|go on|go ahead|please do|do it|tell me|continue|please|да|конечно|ага|давай)$/.test(
    text,
  );
}

export function completionExtras(
  model: string,
  options: { think?: boolean } = {},
): {
  max_tokens: number;
  temperature: number;
  thinking?: { type: "disabled" };
  chat_template_kwargs?: { enable_thinking: boolean };
} {
  if (isPaidModel(model)) {
    return { max_tokens: PAID_MAX_TOKENS, temperature: 0.4, thinking: { type: "disabled" } };
  }
  if (options.think) {
    return {
      max_tokens: THINK_MAX_TOKENS,
      temperature: 0.6,
      chat_template_kwargs: { enable_thinking: true },
    };
  }
  return {
    max_tokens: CHAT_MAX_TOKENS,
    temperature: 0.8,
    chat_template_kwargs: { enable_thinking: false },
  };
}

const THINK_OPEN = "<think>";
const THINK_CLOSE = "</think>";

function partialTagSuffix(text: string, tag: string): number {
  const lower = text.toLowerCase();
  const want = tag.toLowerCase();
  const max = Math.min(want.length - 1, lower.length);
  for (let n = max; n >= 1; n--) {
    if (lower.endsWith(want.slice(0, n))) return n;
  }
  return 0;
}

/**
 * Pull Qwen `<think>` blocks out of a growing stream.
 * A tag split across chunks is held back until it is complete.
 * An unclosed `<think>` at the end stays in thinking, not in the answer.
 */
export function stripThinking(raw: string): { answer: string; thinking: string; inThink: boolean } {
  const lower = raw.toLowerCase();
  let answer = "";
  let thinking = "";
  let i = 0;
  let inThink = false;
  while (i < raw.length) {
    const tag = inThink ? THINK_CLOSE : THINK_OPEN;
    const at = lower.indexOf(tag, i);
    if (at < 0) {
      const rest = raw.slice(i);
      if (inThink) thinking += rest;
      else answer += rest;
      break;
    }
    if (inThink) thinking += raw.slice(i, at);
    else answer += raw.slice(i, at);
    i = at + tag.length;
    inThink = !inThink;
  }
  if (!inThink) {
    const held = partialTagSuffix(answer, THINK_OPEN);
    if (held > 0) answer = answer.slice(0, answer.length - held);
  } else {
    const held = partialTagSuffix(thinking, THINK_CLOSE);
    if (held > 0) thinking = thinking.slice(0, thinking.length - held);
  }
  return {
    answer: answer.replace(/[ \t]{2,}/g, " ").trim(),
    thinking: thinking.trim(),
    inThink,
  };
}

/** Spoken and shown text. Thinking is never the answer. */
export function visibleReply(text: string, reasoning: string): { answer: string; thinking: string; inThink: boolean } {
  const stripped = stripThinking(text);
  const thinking = [reasoning.trim(), stripped.thinking].filter(Boolean).join("\n").trim();
  return { answer: stripped.answer, thinking, inThink: stripped.inThink };
}

/**
 * The brain base for a chat turn. A running gateway is ignored on purpose:
 * sending the turn to :4000 drops the pairing token on the way back to the brain.
 */
export async function resolveChatBase(
  brainUrl: string,
  _fetchImpl: typeof fetch = fetch,
): Promise<{ base: string; via: "proxy" }> {
  void _fetchImpl;
  return { base: chatTarget("local", brainUrl).base, via: "proxy" };
}

function messagesForModel(messages: readonly ChatMessage[], model: string): ChatMessage[] {
  const copy = messages.map((message) => ({ ...message }));
  if (isPaidModel(model)) return copy;
  const last = copy[copy.length - 1];
  if (last && last.role === "user" && !/\/(?:no_)?think\b/.test(last.content)) {
    last.content = `${last.content}\n/no_think`;
  }
  return copy;
}

/** The bubble name. A backup-brain reply says so; everything else stays as it was. */
export function replySourceLabel(who: string | undefined, brain?: string): string {
  if (who === "paid") return "deepseek-flash";
  if (who === "user") return "You";
  return brain === "backup" ? "Preyas · backup brain" : "Preyas";
}

/** What a reply reports when the person pressed stop. The UI shows this text. */
export const STOPPED_ERROR = "stopped";

export async function streamReply(options: {
  base: string;
  model: string;
  messages: readonly ChatMessage[];
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  /** Let the local model reason first. The reasoning is never shown. */
  think?: boolean;
  onDelta?: (update: { answer: string; thinking: string; inThink: boolean }) => void;
  /** Fires once, when the response headers arrive. "backup" or "". */
  onBrain?: (brain: "backup" | "") => void;
  /**
   * The caller's own stop button. Aborting it ends the request the same way the
   * timeout does; the reply is reported as "stopped" rather than as a failure,
   * so the UI can say what really happened.
   */
  signal?: AbortSignal;
}): Promise<{ text: string; thinking: string; usage: TokenUsage | null; ok: boolean; error: string; brain: "backup" | "" }> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? LOCAL_TIMEOUT_MS);
  /** True only when the person pressed stop, never when we timed out. */
  let stopped = false;
  const onStop = () => {
    stopped = true;
    controller.abort();
  };
  if (options.signal) {
    if (options.signal.aborted) onStop();
    else options.signal.addEventListener("abort", onStop);
  }
  try {
    if (stopped) throw new Error(STOPPED_ERROR);
    const res = await fetchImpl(`${options.base.replace(/\/$/, "")}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: options.model,
        stream: true,
        ...completionExtras(options.model, { think: options.think }),
        repeat_penalty: 1.1,
        presence_penalty: 0.3,
        frequency_penalty: 0.3,
        stream_options: { include_usage: true },
        messages: messagesForModel(options.messages, options.model).map((message) => ({
          role: message.role,
          content: message.content,
        })),
      }),
      signal: controller.signal,
    });
    if (stopped) throw new Error(STOPPED_ERROR);
    const brain = res.headers.get("x-preyas-brain") === "backup" ? "backup" : "";
    options.onBrain?.(brain);
    if (!res.ok || !res.body) {
      let error = res.ok ? "empty" : `status ${res.status}`;
      // The brain explains refusals in its JSON body ("switching models…");
      // surface that text instead of a bare status code.
      if (!res.ok && res.body) {
        try {
          const parsed = (await res.json().catch(() => null)) as { error?: unknown } | null;
          if (parsed && typeof parsed.error === "string" && parsed.error.trim()) error = parsed.error;
        } catch {
          /* keep the status text */
        }
      }
      if (stopped) throw new Error(STOPPED_ERROR);
      return { text: "", thinking: "", usage: null, ok: false, error, brain };
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    let text = "";
    let reasoning = "";
    let usage: TokenUsage | null = null;
    for (;;) {
      const step = await reader.read();
      if (stopped) throw new Error(STOPPED_ERROR);
      if (step.done) break;
      buf += decoder.decode(step.value, { stream: true });
      const parts = buf.split("\n");
      buf = parts.pop() ?? "";
      for (let i = 0; i < parts.length; i++) {
        if (stopped) throw new Error(STOPPED_ERROR);
        const piece = parseSseBlock(parts[i]!);
        text += piece.text;
        reasoning += piece.reasoning;
        if (piece.text || piece.reasoning) options.onDelta?.(visibleReply(text, reasoning));
        if (piece.usage) usage = piece.usage;
      }
    }
    if (buf.trim()) {
      const piece = parseSseBlock(buf);
      text += piece.text;
      reasoning += piece.reasoning;
      if (piece.usage) usage = piece.usage;
      const shown = visibleReply(text, reasoning);
      if (shown.answer || shown.thinking) options.onDelta?.(shown);
    }
    if (stopped) throw new Error(STOPPED_ERROR);
    const shown = visibleReply(text, reasoning);
    return {
      text: shown.answer,
      thinking: shown.thinking,
      usage,
      ok: Boolean(shown.answer),
      error: shown.answer ? "" : "empty reply",
      brain,
    };
  } catch (error) {
    // A stop is not a failure: the person asked for it, and the UI says so.
    if (stopped) return { text: "", thinking: "", usage: null, ok: false, error: STOPPED_ERROR, brain: "" };
    const message = error instanceof Error ? error.message : String(error);
    return { text: "", thinking: "", usage: null, ok: false, error: message, brain: "" };
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", onStop);
  }
}

/**
 * A turn-count meter kept for the legacy single-file history.
 * The chat header and Today use the life-log level in rpgLevel.ts instead,
 * so this must not be shown per chat.
 */
export function partnerFromTurns(turns: number): { turns: number; level: number; bond: number; caption: string } {
  const n = Number.isFinite(turns) ? Math.max(0, Math.floor(turns)) : 0;
  const level = Math.min(40, 1 + Math.floor(n / 3));
  const bond = Math.min(100, n * 4);
  let caption = "Just met. The room is still new.";
  if (bond >= 80) caption = "Trusted friend and battle partner.";
  else if (bond >= 48) caption = "He shows off, but he stays.";
  else if (bond >= 16) caption = "Getting used to your voice.";
  return { turns: n, level, bond, caption };
}

export function parseSseBlock(block: string): SsePiece {
  const lines = block.split("\n");
  let text = "";
  let reasoning = "";
  let usage: TokenUsage | null = null;
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i]!.trim();
    if (!trimmed.startsWith("data:")) continue;
    const payload = trimmed.slice(5).trim();
    if (!payload || payload === "[DONE]") continue;
    try {
      const json = JSON.parse(payload) as {
        choices?: {
          delta?: { content?: string; reasoning_content?: string };
          message?: { content?: string; reasoning_content?: string };
        }[];
        usage?: TokenUsage;
      };
      const choice = json.choices?.[0];
      text += choice?.delta?.content || choice?.message?.content || "";
      reasoning += choice?.delta?.reasoning_content || choice?.message?.reasoning_content || "";
      if (json.usage && (json.usage.prompt_tokens || json.usage.completion_tokens)) usage = json.usage;
    } catch {
      /* incomplete chunk */
    }
  }
  return { text, reasoning, usage };
}
