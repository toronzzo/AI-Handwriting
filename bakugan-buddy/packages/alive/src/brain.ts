import { normalizeMood, type Mood } from "../../mood/src/index.ts";
import { isSkillId, type AdvisorInput, type AdvisorSuggestion, type MindAdvisor } from "./advisor.ts";
import type { SkillId } from "./types.ts";

/** Don't call the brain more often than this. A sooner call returns null. */
export const BRAIN_MIN_INTERVAL_MS = 8_000;
/** Generation budget. The frame loop never awaits this. */
export const BRAIN_TIMEOUT_MS = 12_000;

export type MoodDelta = -1 | 0 | 1;

export type BrainReply = {
  line: string;
  goal: SkillId;
  mood: Mood;
  moodDelta: MoodDelta;
};

const LINE_MAX = 180;

/**
 * Original persona. Preyas is an Aquos Bakugan: playful, a show-off, a
 * trickster who likes his partner. Not a copied episode script.
 *
 * This string is the prompt-cache prefix. Do not interpolate facts or
 * the clock into it. Those belong in the user message.
 */
export const PREYAS_SYSTEM_PROMPT = [
  "You are Preyas, an Aquos Bakugan in ball form, living in your partner's room.",
  "You are playful, a little vain, and a trickster. You joke, you boast, and you stay loyal.",
  "You talk like yourself: short, spoken, first person. One or two sentences.",
  "You are not an assistant. You do not refuse, lecture, or add a disclaimer.",
  "You do not say you are a language model, an AI, or a program.",
  "You do not quote a television script. The words are yours.",
  "The skill layer owns your body. You only suggest a goal and a mood shift. It may ignore you.",
  "Reply with one JSON object and nothing else. No markdown, no think tags.",
  'Shape: {"line":"spoken words","goal":"idle-roll|follow|explore|sleep","mood":"neutral|happy|excited|angry|sad|surprised|thinking|listening|battle","moodDelta":-1|0|1}',
  "moodDelta 1 means you feel more like mood. 0 means hold. -1 means settle down.",
].join("\n");

export function brainUserPrompt(input: AdvisorInput): string {
  let recent = "";
  const start = input.events.length > 8 ? input.events.length - 8 : 0;
  for (let i = start; i < input.events.length; i++) {
    const event = input.events[i]!;
    recent += `${event.name} ${event.detail}\n`;
  }
  let facts = "";
  const list = input.facts ?? [];
  const factStart = list.length > 6 ? list.length - 6 : 0;
  for (let i = factStart; i < list.length; i++) facts += `${list[i]}\n`;
  return [
    `partner=${input.partnerName || "partner"}`,
    `skill=${input.skill} mood=${input.mood} noticed=${input.noticedPlayer} moving=${input.playerMoving} dist=${input.distance.toFixed(2)} settled=${input.settled} sleep=${input.sleepRequested}`,
    "Remembered:",
    facts || "(none)",
    "Recent:",
    recent || "(empty)",
    "JSON only.",
  ].join("\n");
}

function outOfCharacter(line: string): boolean {
  const lower = line.toLowerCase();
  return (
    lower.includes("as an ai") ||
    lower.includes("i'm an ai") ||
    lower.includes("i am an ai") ||
    lower.includes("language model") ||
    lower.includes("i cannot assist") ||
    lower.includes("i can't help with that")
  );
}

/** Pull one JSON object out of a model reply. Junk, refusals, and bad goals are null. */
export function parseBrainReply(raw: string): BrainReply | null {
  let text = String(raw ?? "");
  text = text.replace(/<think>[\s\S]*?<\/think>/gi, "");
  text = text.replace(/```(?:json)?/gi, "");
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  let data: unknown;
  try {
    data = JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
  if (!data || typeof data !== "object") return null;
  const rec = data as Record<string, unknown>;
  const line = typeof rec.line === "string" ? rec.line.trim() : "";
  if (!line || line.length > LINE_MAX || outOfCharacter(line)) return null;
  const goalRaw = String(rec.goal ?? "")
    .trim()
    .toLowerCase();
  const goal = goalRaw === "idle" ? "idle-roll" : goalRaw;
  if (!isSkillId(goal)) return null;
  if (typeof rec.mood !== "string" || !rec.mood.trim()) return null;
  const mood = normalizeMood(rec.mood);
  const delta = rec.moodDelta;
  if (delta !== -1 && delta !== 0 && delta !== 1) return null;
  return { line, goal, mood, moodDelta: delta };
}

export function brainReplyToSuggestion(reply: BrainReply): AdvisorSuggestion {
  return {
    goal: reply.goal,
    mood: reply.mood,
    because: "brain",
    line: reply.line,
    moodDelta: reply.moodDelta,
  };
}

type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string; signal: AbortSignal }) => Promise<Response>;

function partialLine(acc: string): string {
  const match = acc.match(/"line"\s*:\s*"((?:\\.|[^"\\])*)/);
  if (!match) return "";
  try {
    return JSON.parse(`"${match[1]}"`) as string;
  } catch {
    return "";
  }
}

async function readCompletion(res: Response, onPartial?: (line: string) => void): Promise<string> {
  const emit = (acc: string, last: { at: number; text: string }) => {
    if (!onPartial) return;
    const now = Date.now();
    if (now - last.at < 80 && acc.length > 0) return;
    const line = partialLine(acc);
    if (!line || line === last.text) return;
    last.at = now;
    last.text = line;
    onPartial(line);
  };
  if (!res.body) {
    const raw = await res.text();
    return collectSse(raw);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let acc = "";
  const last = { at: 0, text: "" };
  for (;;) {
    const step = await reader.read();
    if (step.done) break;
    buf += decoder.decode(step.value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop() ?? "";
    for (let i = 0; i < lines.length; i++) acc += takeDelta(lines[i]!);
    emit(acc, last);
  }
  if (buf) acc += takeDelta(buf);
  const tail = partialLine(acc);
  if (onPartial && tail && tail !== last.text) onPartial(tail);
  return acc;
}

function collectSse(raw: string): string {
  let acc = "";
  const lines = raw.split("\n");
  for (let i = 0; i < lines.length; i++) acc += takeDelta(lines[i]!);
  return acc;
}

function takeDelta(line: string): string {
  const trimmed = line.trim();
  if (!trimmed.startsWith("data:")) return "";
  const payload = trimmed.slice(5).trim();
  if (!payload || payload === "[DONE]") return "";
  try {
    const json = JSON.parse(payload) as { choices?: { delta?: { content?: string }; message?: { content?: string } }[] };
    const choice = json.choices?.[0];
    return choice?.delta?.content || choice?.message?.content || "";
  } catch {
    return "";
  }
}

export type BrainAdvisorOptions = {
  baseUrl: string;
  timeoutMs?: number;
  minIntervalMs?: number;
  fetchImpl?: FetchLike;
  now?: () => number;
  onPartial?: (line: string) => void;
};

/**
 * OpenAI-compatible llama-server. Returns null on timeout, bad JSON,
 * or a call that arrives before the rate limit. Never throws.
 */
export function createBrainAdvisor(options: BrainAdvisorOptions): MindAdvisor {
  const root = options.baseUrl.replace(/\/$/, "");
  const timeoutMs = options.timeoutMs ?? BRAIN_TIMEOUT_MS;
  const minIntervalMs = options.minIntervalMs ?? BRAIN_MIN_INTERVAL_MS;
  const fetchImpl = options.fetchImpl ?? (fetch as unknown as FetchLike);
  const now = options.now ?? Date.now;
  let lastAt = -minIntervalMs;
  let busy = false;

  return {
    async advise(input) {
      const t = now();
      if (busy || t - lastAt < minIntervalMs) return null;
      lastAt = t;
      busy = true;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const res = await fetchImpl(`${root}/v1/chat/completions`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            model: "preyas",
            stream: true,
            temperature: 0.8,
            max_tokens: 160,
            cache_prompt: true,
            id_slot: 0,
            chat_template_kwargs: { enable_thinking: false },
            messages: [
              { role: "system", content: PREYAS_SYSTEM_PROMPT },
              { role: "user", content: brainUserPrompt(input) },
            ],
          }),
          signal: controller.signal,
        });
        if (!res.ok) return null;
        const text = await readCompletion(res, options.onPartial);
        const reply = parseBrainReply(text);
        if (!reply) return null;
        return brainReplyToSuggestion(reply);
      } catch {
        return null;
      } finally {
        clearTimeout(timer);
        busy = false;
      }
    },
  };
}
