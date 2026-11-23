/**
 * Pure model for the Raw Qwen screen.
 *
 * Raw chats are local-only: they live under their own AsyncStorage keys and
 * never touch the brain's chats, notes or facts. The SSE reader and the stat
 * formatter are pure so they can be tested with node --test.
 */

export type RawRole = "user" | "assistant";

export type RawStats = {
  /** Tokens per second from llama's timings, or a live estimate. */
  tokensPerSecond: number;
  /** Predicted tokens so far. */
  tokens: number;
  /** Generation time in milliseconds. */
  ms: number;
};

export type RawMessage = {
  id: string;
  role: RawRole;
  content: string;
  /** The model's own reasoning, streamed separately by llama-server. */
  reasoning: string;
  stats: RawStats | null;
  at: number;
  stopped?: boolean;
};

export type RawChat = {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: RawMessage[];
};

export type RawSettings = {
  temperature: number;
  topP: number;
  maxTokens: number;
  systemPrompt: string;
};

export type RawTimings = {
  prompt_n?: number;
  prompt_ms?: number;
  prompt_per_second?: number;
  predicted_n?: number;
  predicted_ms?: number;
  predicted_per_second?: number;
};

export type RawSseFrame = {
  content: string;
  reasoning: string;
  timings: RawTimings | null;
  done: boolean;
};

export type RawChatStore = {
  getItem: (key: string) => Promise<string | null>;
  setItem: (key: string, value: string) => Promise<void>;
};

export const DEFAULT_RAW_SETTINGS: RawSettings = {
  temperature: 0.7,
  topP: 0.95,
  maxTokens: 512,
  systemPrompt: "",
};

/** Local-only. These keys are deliberately distinct from every Preyas key. */
export const RAW_CHATS_KEY = "bakugan-buddy.raw.chats.v1";
export const RAW_SETTINGS_KEY = "bakugan-buddy.raw.settings.v1";
export const RAW_MAX_CHATS = 50;

function finite(value: unknown): number | null {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : null;
}

function clamp(value: unknown, fallback: number, min: number, max: number): number {
  const number = finite(value);
  if (number === null) return fallback;
  return Math.min(max, Math.max(min, number));
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function randomId(now: number): string {
  return `raw-${now.toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function newRawChat(now = Date.now(), id = randomId(now)): RawChat {
  return { id, title: "New chat", createdAt: now, updatedAt: now, messages: [] };
}

/** First line of the first user message, capped so the list stays tidy. */
export function rawChatTitle(text: string): string {
  const first = String(text || "")
    .split("\n")
    .map((line) => line.trim())
    .find(Boolean);
  if (!first) return "New chat";
  return first.length > 48 ? `${first.slice(0, 45)}…` : first;
}

export function addRawMessage(chat: RawChat, message: RawMessage): RawChat {
  const hadUser = chat.messages.some((row) => row.role === "user");
  const messages = [...chat.messages, message];
  return {
    ...chat,
    messages,
    title: !hadUser && message.role === "user" ? rawChatTitle(message.content) : chat.title,
    updatedAt: Math.max(chat.updatedAt, message.at),
  };
}

export function normalizeRawSettings(input: unknown): RawSettings {
  const raw = input && typeof input === "object" && !Array.isArray(input) ? (input as Partial<RawSettings>) : {};
  const systemPrompt = typeof raw.systemPrompt === "string" ? raw.systemPrompt.slice(0, 8_000) : "";
  return {
    temperature: clamp(raw.temperature, DEFAULT_RAW_SETTINGS.temperature, 0, 2),
    topP: clamp(raw.topP, DEFAULT_RAW_SETTINGS.topP, 0, 1),
    maxTokens: Math.round(clamp(raw.maxTokens, DEFAULT_RAW_SETTINGS.maxTokens, 1, 8192)),
    systemPrompt,
  };
}

/** The exact messages sent to llama; reasoning is not replayed as context. */
export function buildRawMessages(chat: RawChat, settings: RawSettings): { role: "system" | RawRole; content: string }[] {
  const rows: { role: "system" | RawRole; content: string }[] = [];
  const system = settings.systemPrompt.trim();
  if (system) rows.push({ role: "system", content: system });
  for (const message of chat.messages) {
    const content = message.content.trim();
    if (content) rows.push({ role: message.role, content: message.content });
  }
  return rows;
}

/** Request body for POST /v1/raw/chat. */
export function rawChatPayload(chat: RawChat, settings: RawSettings): Record<string, unknown> {
  const normalized = normalizeRawSettings(settings);
  return {
    messages: buildRawMessages(chat, normalized),
    temperature: normalized.temperature,
    top_p: normalized.topP,
    max_tokens: normalized.maxTokens,
    stream: true,
  };
}

/**
 * Split an SSE buffer at complete blank-line boundaries. The tail stays in
 * `rest` until the next network chunk arrives.
 */
export function parseRawSse(buffer: string): { frames: RawSseFrame[]; rest: string } {
  const frames: RawSseFrame[] = [];
  const blocks = String(buffer || "").replace(/\r\n/g, "\n").split("\n\n");
  const rest = blocks.pop() ?? "";
  for (const block of blocks) {
    const data = block
      .split("\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).replace(/^ /, ""))
      .join("\n")
      .trim();
    if (!data) continue;
    if (data === "[DONE]") {
      frames.push({ content: "", reasoning: "", timings: null, done: true });
      continue;
    }
    let json: unknown;
    try {
      json = JSON.parse(data);
    } catch {
      continue;
    }
    const body = json && typeof json === "object" ? (json as Record<string, unknown>) : {};
    const choices = Array.isArray(body.choices) ? body.choices : [];
    const choice = choices[0] && typeof choices[0] === "object" ? (choices[0] as Record<string, unknown>) : {};
    const delta = choice.delta && typeof choice.delta === "object" ? (choice.delta as Record<string, unknown>) : {};
    const content = typeof delta.content === "string" ? delta.content : "";
    const reasoning =
      typeof delta.reasoning_content === "string"
        ? delta.reasoning_content
        : typeof delta.reasoning === "string"
          ? delta.reasoning
          : "";
    const timings =
      body.timings && typeof body.timings === "object" && !Array.isArray(body.timings)
        ? (body.timings as RawTimings)
        : null;
    frames.push({ content, reasoning, timings, done: false });
  }
  return { frames, rest };
}

/** llama's final timings, with a live fallback while the first chunks arrive. */
export function statsFromTimings(
  timings: RawTimings | null,
  startedAt: number,
  now: number,
  fallbackTokens = 0,
): RawStats {
  const elapsed = Math.max(1, now - startedAt);
  const tokens = Math.max(0, Math.round(finite(timings?.predicted_n) ?? fallbackTokens));
  const predictedMs = finite(timings?.predicted_ms) ?? 0;
  const ms = predictedMs >= 1 ? predictedMs : elapsed;
  const reported = finite(timings?.predicted_per_second) ?? 0;
  const tokensPerSecond = reported > 0 ? reported : tokens > 0 ? tokens / (elapsed / 1000) : 0;
  return { tokensPerSecond: round1(tokensPerSecond), tokens, ms: Math.round(ms) };
}

export function liveStats(tokens: number, startedAt: number, now: number): RawStats {
  const elapsed = Math.max(1, now - startedAt);
  return {
    tokensPerSecond: round1(tokens > 0 ? tokens / (elapsed / 1000) : 0),
    tokens: Math.max(0, Math.round(tokens)),
    ms: Math.round(elapsed),
  };
}

/** The line under every assistant reply, like llama.cpp's message stats. */
export function formatRawStats(stats: RawStats | null): string {
  if (!stats) return "";
  const tps = stats.tokensPerSecond > 0 ? `${stats.tokensPerSecond.toFixed(1)} tok/s` : "— tok/s";
  const time = stats.ms >= 1_000 ? `${(stats.ms / 1_000).toFixed(1)} s` : `${Math.max(0, Math.round(stats.ms))} ms`;
  return `${tps} · ${stats.tokens} tokens · ${time}`;
}

function cleanMessage(row: unknown): RawMessage | null {
  if (!row || typeof row !== "object") return null;
  const raw = row as Partial<RawMessage>;
  if (raw.role !== "user" && raw.role !== "assistant") return null;
  if (typeof raw.content !== "string") return null;
  return {
    id: typeof raw.id === "string" && raw.id ? raw.id : `msg-${Math.random().toString(36).slice(2, 9)}`,
    role: raw.role,
    content: raw.content.slice(0, 100_000),
    reasoning: typeof raw.reasoning === "string" ? raw.reasoning.slice(0, 100_000) : "",
    stats:
      raw.stats && typeof raw.stats === "object" && "tokens" in raw.stats
        ? {
            tokensPerSecond: clamp(raw.stats.tokensPerSecond, 0, 0, 100_000),
            tokens: Math.round(clamp(raw.stats.tokens, 0, 0, 1_000_000)),
            ms: Math.round(clamp(raw.stats.ms, 0, 0, 86_400_000)),
          }
        : null,
    at: finite(raw.at) ?? Date.now(),
    stopped: raw.stopped === true,
  };
}

function cleanChat(row: unknown): RawChat | null {
  if (!row || typeof row !== "object") return null;
  const raw = row as Partial<RawChat>;
  if (typeof raw.id !== "string" || !raw.id) return null;
  const messages = Array.isArray(raw.messages)
    ? raw.messages.map(cleanMessage).filter((message): message is RawMessage => Boolean(message))
    : [];
  return {
    id: raw.id,
    title: typeof raw.title === "string" && raw.title.trim() ? raw.title.slice(0, 80) : "Raw chat",
    createdAt: finite(raw.createdAt) ?? Date.now(),
    updatedAt: finite(raw.updatedAt) ?? Date.now(),
    messages,
  };
}

export async function loadRawChats(store: RawChatStore): Promise<RawChat[]> {
  try {
    const raw = await store.getItem(RAW_CHATS_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map(cleanChat)
      .filter((chat): chat is RawChat => Boolean(chat))
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, RAW_MAX_CHATS);
  } catch {
    return [];
  }
}

/** Only the raw-chat key is written: no brain chat or memory file is touched. */
export async function saveRawChats(store: RawChatStore, chats: RawChat[]): Promise<void> {
  const clean = chats
    .map(cleanChat)
    .filter((chat): chat is RawChat => Boolean(chat))
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, RAW_MAX_CHATS);
  await store.setItem(RAW_CHATS_KEY, JSON.stringify(clean));
}

export async function loadRawSettings(store: RawChatStore): Promise<RawSettings> {
  try {
    const raw = await store.getItem(RAW_SETTINGS_KEY);
    if (!raw) return { ...DEFAULT_RAW_SETTINGS };
    return normalizeRawSettings(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_RAW_SETTINGS };
  }
}

export async function saveRawSettings(store: RawChatStore, settings: RawSettings): Promise<void> {
  await store.setItem(RAW_SETTINGS_KEY, JSON.stringify(normalizeRawSettings(settings)));
}

export function upsertRawChat(chats: RawChat[], chat: RawChat): RawChat[] {
  return [chat, ...chats.filter((row) => row.id !== chat.id)]
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, RAW_MAX_CHATS);
}

export function removeRawChat(chats: RawChat[], id: string): RawChat[] {
  return chats.filter((chat) => chat.id !== id);
}
