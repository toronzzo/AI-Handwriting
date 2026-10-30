import { normalizeMood, parseTagged, type Mood } from "../../mood/src/index.ts";
import type { MemoryEvent, SkillId } from "./types.ts";
import { ADVICE_HOLD_MS, HURRY_DISTANCE } from "./tuning.ts";

/**
 * Mind advisor
 * -------------
 * The phone runs the skill picker every frame and never waits. A mind
 * (a small local model on the studio sidecar, or the built-in mock)
 * may look at the memory log every few seconds and suggest a goal and
 * a mood. The suggestion is a hint:
 *
 * - `offerAdvice` stores it. It does not change the skill by itself.
 * - The picker runs `skillWants` as usual. If the suggested skill does
 *   not want the frame, the hint is ignored and a skill that does want
 *   it runs instead. Idle-roll still cannot lose to an empty list.
 * - Mood is a canonical tag from `@bakugan-buddy/mood`. A button override
 *   on the phone wins over the hint. Hurry and the notice beat still
 *   perform their own body language.
 * - `advise` is async and must be called off the frame tick. A null
 *   return means "no opinion"; the last hint expires on its own.
 *
 * Wire a real model with `createStudioAdvisor(baseUrl)`. It POSTs to
 * Home Studio `POST /v1/chat` and reads a single `[mood] goal` line.
 * If the sidecar is down or the line is junk, it returns null and the
 * mock (or silence) keeps the room alive.
 */
export type AdvisorSuggestion = {
  goal: SkillId;
  mood: Mood;
  /** Short reason stored in the log, not spoken. */
  because: string;
  /** Spoken line from a brain. The next tick says it instead of a canned bark. */
  line?: string;
  /**
   * 1 adopt `mood`, 0 leave the body's mood alone, -1 calm the current mood.
   * Missing means the older absolute hint: use `mood`.
   */
  moodDelta?: -1 | 0 | 1;
};

export type AdvisorInput = {
  nowMs: number;
  skill: SkillId;
  mood: Mood;
  noticedPlayer: boolean;
  playerMoving: boolean;
  distance: number;
  sleepRequested: boolean;
  settled: boolean;
  events: readonly MemoryEvent[];
  /** Partner facts from the emotion-state store. Optional. */
  facts?: readonly string[];
  partnerName?: string;
  /** Something the partner just said. Bypasses the idle rate limit. */
  heard?: string;
};

export interface MindAdvisor {
  advise(input: AdvisorInput): Promise<AdvisorSuggestion | null>;
}

export function isSkillId(value: string): value is SkillId {
  return value === "idle-roll" || value === "follow" || value === "explore" || value === "sleep";
}

/** Parses `[happy] follow` or `follow`. Anything else is not advice. */
export function parseAdvisorReply(raw: string): AdvisorSuggestion | null {
  const text = String(raw ?? "").trim();
  if (!text) return null;
  const parsed = parseTagged(text);
  const source = parsed.complete ? parsed.text : text;
  const token = source.trim().toLowerCase().split(/\s+/)[0] ?? "";
  const goal = token === "idle" ? "idle-roll" : token;
  if (!isSkillId(goal)) return null;
  return { goal, mood: parsed.mood, because: "studio" };
}

const SETTLED_MOODS: readonly Mood[] = ["happy", "neutral", "sad", "angry"];

/** Deterministic stand-in. Reads the same snapshot a model would. */
export function mockSuggest(input: AdvisorInput): AdvisorSuggestion {
  if (input.sleepRequested && !input.playerMoving) {
    return { goal: "sleep", mood: "neutral", because: "tucked in" };
  }
  if (!input.noticedPlayer) {
    return { goal: "explore", mood: "thinking", because: "not sure yet" };
  }
  if (input.playerMoving && input.distance > HURRY_DISTANCE) {
    return { goal: "follow", mood: "excited", because: "you're far" };
  }
  if (input.playerMoving) {
    return { goal: "follow", mood: "happy", because: "staying with you" };
  }
  if (input.settled) {
    const mood = SETTLED_MOODS[Math.floor(input.nowMs / 8000) % SETTLED_MOODS.length]!;
    return { goal: "explore", mood, because: "quiet room" };
  }
  return { goal: "idle-roll", mood: "neutral", because: "waiting" };
}

export class MockMindAdvisor implements MindAdvisor {
  advise(input: AdvisorInput): Promise<AdvisorSuggestion | null> {
    return Promise.resolve(mockSuggest(input));
  }
}

export function chainAdvisors(primary: MindAdvisor, fallback: MindAdvisor): MindAdvisor {
  return {
    async advise(input) {
      const suggestion = await primary.advise(input);
      if (suggestion) return suggestion;
      return fallback.advise(input);
    },
  };
}

export function advisorPrompt(input: AdvisorInput): string {
  let recent = "";
  const start = input.events.length > 8 ? input.events.length - 8 : 0;
  for (let i = start; i < input.events.length; i++) {
    const event = input.events[i]!;
    recent += `${event.t} ${event.name} ${event.detail}\n`;
  }
  return [
    "You advise Preyas, a living partner who stays in ball form in his room.",
    "Reply with ONE line and nothing else: [mood] goal",
    "mood is one of: neutral happy excited angry sad surprised thinking listening battle",
    "goal is one of: idle-roll follow explore sleep",
    "He may ignore you. Do not explain.",
    `skill=${input.skill} mood=${input.mood} noticed=${input.noticedPlayer} moving=${input.playerMoving} dist=${input.distance.toFixed(2)} settled=${input.settled} sleep=${input.sleepRequested}`,
    "Recent memory:",
    recent || "(empty)",
  ].join("\n");
}

function takeToken(line: string): string {
  const trimmed = line.trim();
  if (!trimmed) return "";
  try {
    const event = JSON.parse(trimmed) as { type?: string; text?: string };
    if (event.type === "token" && event.text) return event.text;
  } catch {
    return "";
  }
  return "";
}

async function readStudioText(res: Response): Promise<string> {
  if (!res.body) {
    const raw = await res.text();
    let out = "";
    const lines = raw.split("\n");
    for (let i = 0; i < lines.length; i++) out += takeToken(lines[i]!);
    return out;
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let out = "";
  for (;;) {
    const step = await reader.read();
    if (step.done) break;
    buf += decoder.decode(step.value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop() ?? "";
    for (let i = 0; i < lines.length; i++) out += takeToken(lines[i]!);
  }
  if (buf) out += takeToken(buf);
  return out;
}

/**
 * Home Studio on the Mac (`POST /v1/chat`). Times out and returns null
 * on any failure so the frame loop is never involved.
 */
export function createStudioAdvisor(baseUrl: string, timeoutMs = 1500): MindAdvisor {
  const root = baseUrl.replace(/\/$/, "");
  return {
    async advise(input) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const res = await fetch(`${root}/v1/chat`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            text: advisorPrompt(input),
            form: "sphere",
            partnerName: "partner",
            facts: input.events.slice(-8).map((event) => `${event.name}:${event.detail}`),
          }),
          signal: controller.signal,
        });
        if (!res.ok) return null;
        const text = await readStudioText(res);
        const suggestion = parseAdvisorReply(text);
        if (!suggestion) return null;
        suggestion.mood = normalizeMood(suggestion.mood);
        return suggestion;
      } catch {
        return null;
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

export const ADVICE_TTL_MS = ADVICE_HOLD_MS;
