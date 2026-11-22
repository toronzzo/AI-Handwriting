/**
 * Offline emoji knowledge for Preyas.
 *
 * The dataset is Unicode 18 emoji-test.txt plus CLDR 49 English short names
 * and keywords, compacted in ./emoji/emoji-data.json (Unicode License v3,
 * see ./emoji/LICENSE). Nothing is downloaded at chat time.
 *
 * A turn only sees a small palette: matches from the partner's words, a few
 * emoji for Preyas's current mood, and a reading of any emoji they sent.
 * The whole note stays under a few hundred tokens so an 8K context still fits.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { emojiClusters } from "../../packages/alive/src/emojiRuns.ts";

export const EMOJI_PROMPT_MAX = 900;
export const EMOJI_MODE_MAX = 1400;
export const PALETTE_LIMIT = 8;
export const PALETTE_MODE_LIMIT = 16;

const DATA_PATH = fileURLToPath(new URL("./emoji/emoji-data.json", import.meta.url));
const MOODS = ["neutral", "happy", "excited", "angry", "sad", "surprised", "thinking", "listening", "battle"];
const SKIN = {
  "\u{1F3FB}": "light skin tone",
  "\u{1F3FC}": "medium-light skin tone",
  "\u{1F3FD}": "medium skin tone",
  "\u{1F3FE}": "medium-dark skin tone",
  "\u{1F3FF}": "dark skin tone",
};
const VS = /[\uFE0E\uFE0F]/g;
const SKIN_CHARS = /[\u{1F3FB}-\u{1F3FF}]/gu;

const STOP = new Set([
  "the", "a", "an", "and", "or", "but", "if", "then", "to", "of", "in", "on",
  "for", "with", "is", "are", "was", "were", "be", "been", "it", "this", "that",
  "i", "you", "we", "they", "my", "your", "me", "do", "did", "does", "what",
  "how", "why", "when", "who", "which", "tell", "say", "says", "said", "please",
  "just", "about", "from", "into", "out", "mean", "means", "meaning", "emoji",
  "emojis", "only", "more", "answer", "reply", "respond", "use", "using", "stop",
  "mode", "words", "does", "did", "have", "has", "not", "yes", "can", "could",
]);

const MODE_RULES = [
  ["only", /\b(?:answer|reply|respond|talk|speak|write)\s+only\s+(?:in|with)\s+emojis?\b/gi],
  ["only", /\b(?:only|just)\s+emojis?\b/gi],
  ["only", /\bemojis?\s+only\b/gi],
  ["only", /только\s+эмодзи/gi],
  ["only", /\btylko\s+emoji\b/gi],
  ["off", /\bstop\s+emoji\s+mode\b/gi],
  ["off", /\b(?:no|without)\s+emoji\s+mode\b/gi],
  ["off", /\b(?:no|without)\s+emojis?\b/gi],
  ["off", /\bstop(?:\s+using)?\s+emojis?\b/gi],
  ["off", /\bnormal\s+mode\b/gi],
  ["off", /\bwords\s+only\b/gi],
  ["off", /без\s+эмодзи/gi],
  ["off", /\bbez\s+emoji\b/gi],
  ["more", /\b(?:use|add|with)\s+more\s+emojis?\b/gi],
  ["more", /\bmore\s+emojis?\b/gi],
  ["more", /\bemoji\s+mode\b/gi],
  ["more", /\buse\s+emojis?\b/gi],
  ["more", /больше\s+эмодзи/gi],
  ["more", /więcej\s+emoji/gi],
];

let cached = null;

export function normEmoji(emoji) {
  return String(emoji ?? "").replace(VS, "").replace(SKIN_CHARS, "");
}

function tonesOf(emoji) {
  const names = [];
  for (const char of String(emoji)) {
    if (SKIN[char]) names.push(SKIN[char]);
  }
  return names.join(", ");
}

function tokenize(text) {
  return String(text ?? "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length >= 3 && !STOP.has(word));
}

function cleanUser(text) {
  return String(text ?? "").replace(/\n\/(?:no_)?think\s*$/i, "").trim();
}

export function createEmojiIndex(data) {
  const rows = Array.isArray(data?.rows) ? data.rows : [];
  const entries = [];
  const byKey = new Map();
  const byToken = new Map();
  const byPhrase = new Map();
  for (let id = 0; id < rows.length; id++) {
    const row = rows[id];
    if (!Array.isArray(row) || typeof row[0] !== "string") continue;
    const keywords = String(row[2] || "")
      .split("|")
      .map((word) => word.trim().toLowerCase())
      .filter(Boolean);
    const entry = {
      emoji: row[0],
      name: String(row[1] || row[0]),
      keywords,
      group: String(row[3] || "o"),
      moods: String(row[4] || "")
        .split(",")
        .map((mood) => mood.trim())
        .filter(Boolean),
      key: normEmoji(row[0]),
      tokens: new Set(),
      phrases: [],
    };
    const blob = [entry.name, ...keywords];
    for (const piece of blob) {
      const lower = piece.toLowerCase();
      const phrase = lower.replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
      if (phrase.includes(" ") && phrase.length >= 5 && phrase.length <= 48 && !entry.phrases.includes(phrase)) {
        entry.phrases.push(phrase);
      }
      for (const token of tokenize(lower)) entry.tokens.add(token);
    }
    const index = entries.length;
    entries.push(entry);
    if (!byKey.has(entry.key)) byKey.set(entry.key, entry);
    for (const token of entry.tokens) {
      let list = byToken.get(token);
      if (!list) byToken.set(token, (list = []));
      list.push(index);
    }
    for (const phrase of entry.phrases) {
      let list = byPhrase.get(phrase);
      if (!list) byPhrase.set(phrase, (list = []));
      list.push(index);
    }
  }

  const byMood = new Map();
  for (const mood of MOODS) {
    const picked = [];
    const groups = new Map();
    for (let id = 0; id < entries.length && picked.length < 24; id++) {
      const entry = entries[id];
      if (!entry.moods.includes(mood)) continue;
      const count = groups.get(entry.group) || 0;
      if (count >= 2) continue;
      groups.set(entry.group, count + 1);
      picked.push(id);
    }
    byMood.set(mood, picked);
  }

  return {
    unicode: String(data?.unicode || ""),
    cldr: String(data?.cldr || ""),
    license: String(data?.license || ""),
    fullyQualified: Number(data?.fullyQualified) || 0,
    bases: entries.length,
    entries,
    byKey,
    byToken,
    byPhrase,
    byMood,
  };
}

export function getEmojiIndex() {
  if (!cached) cached = createEmojiIndex(JSON.parse(fs.readFileSync(DATA_PATH, "utf8")));
  return cached;
}

function postings(index, token) {
  const direct = index.byToken.get(token);
  if (direct && direct.length) return direct;
  if (token.length > 3 && token.endsWith("s")) return index.byToken.get(token.slice(0, -1)) || [];
  return [];
}

export function lookupEmoji(index, cluster) {
  const tone = tonesOf(cluster);
  const entry = index.byKey.get(normEmoji(cluster));
  if (!entry) {
    return { emoji: cluster, name: "emoji", keywords: [], tone, known: false, key: normEmoji(cluster), group: "" };
  }
  return { ...entry, emoji: cluster, tone, known: true };
}

export function explainEmoji(index, text) {
  const parts = emojiClusters(cleanUser(text))
    .slice(0, 8)
    .map((cluster) => lookupEmoji(index, cluster));
  const combo =
    parts.length >= 2
      ? parts.map((part) => (part.tone ? `${part.name} (${part.tone})` : part.name)).join(" + ")
      : "";
  return { parts, combo };
}

function takeDiverse(entries, ids, limit, perGroup) {
  const out = [];
  const groups = new Map();
  const seen = new Set();
  for (const id of ids) {
    const entry = entries[id];
    if (!entry || seen.has(entry.key)) continue;
    const count = groups.get(entry.group) || 0;
    if (entry.group && count >= perGroup) continue;
    if (entry.group) groups.set(entry.group, count + 1);
    seen.add(entry.key);
    out.push(entry);
    if (out.length >= limit) break;
  }
  return out;
}

export function searchEmoji(index, text, options = {}) {
  const mood = MOODS.includes(options.mood) ? options.mood : "neutral";
  const limit = Math.max(1, Math.min(24, options.limit || PALETTE_LIMIT));
  const scores = new Map();
  const tokens = tokenize(cleanUser(text));
  for (const token of tokens) {
    for (const id of postings(index, token)) scores.set(id, (scores.get(id) || 0) + 5);
  }
  const padded = ` ${cleanUser(text).toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim()} `;
  if (padded.trim()) {
    for (const [phrase, ids] of index.byPhrase) {
      if (!padded.includes(` ${phrase} `)) continue;
      for (const id of ids) scores.set(id, (scores.get(id) || 0) + 8);
    }
  }
  const ranked = [...scores.entries()]
    .sort((a, b) => {
      if (b[1] !== a[1]) return b[1] - a[1];
      const length = index.entries[a[0]].name.length - index.entries[b[0]].name.length;
      if (length !== 0) return length;
      return a[0] - b[0];
    })
    .map(([id]) => id);
  const moodIds = index.byMood.get(mood) || [];
  const chosen = new Set(ranked);
  return takeDiverse(index.entries, ranked.concat(moodIds.filter((id) => !chosen.has(id))), limit, 3);
}

function lastMode(text) {
  const hits = [];
  for (const [name, pattern] of MODE_RULES) {
    pattern.lastIndex = 0;
    for (const match of String(text ?? "").matchAll(pattern)) {
      hits.push({ name, index: match.index ?? 0, length: match[0].length });
    }
  }
  // "stop emoji mode" contains "emoji mode". The longer phrase wins.
  const kept = hits.filter(
    (hit) =>
      !hits.some(
        (other) =>
          other !== hit &&
          other.length > hit.length &&
          other.index <= hit.index &&
          other.index + other.length >= hit.index + hit.length,
      ),
  );
  kept.sort((a, b) => a.index - b.index || b.length - a.length);
  return kept.length ? kept[kept.length - 1].name : null;
}

export function emojiModeFromText(text) {
  return lastMode(cleanUser(text));
}

export function emojiModeFromMessages(messages) {
  let mode = null;
  for (const message of messages || []) {
    if (!message || message.role !== "user" || typeof message.content !== "string") continue;
    const next = emojiModeFromText(message.content);
    if (next) mode = next;
  }
  return mode;
}

function partLabel(part) {
  const tone = part.tone ? ` (${part.tone})` : "";
  const words = (part.keywords || []).filter((word) => word !== part.name.toLowerCase()).slice(0, 3);
  const extra = words.length ? ` — ${words.join(", ")}` : "";
  return `${part.emoji} ${part.name}${tone}${extra}`;
}

export function buildEmojiPrompt(options) {
  const index = options.index;
  const mode = options.mode || null;
  const max = mode === "only" || mode === "more" ? EMOJI_MODE_MAX : EMOJI_PROMPT_MAX;
  const limit = mode === "only" || mode === "more" ? PALETTE_MODE_LIMIT : PALETTE_LIMIT;
  const text = cleanUser(options.text || "");
  const explained = explainEmoji(index, text).parts;
  // Names of emoji they sent count as search words, so the palette stays on
  // that subject instead of filling up with unrelated mood faces.
  const hint = explained
    .filter((part) => part.known)
    .map((part) => part.name)
    .join(" ");
  const palette = searchEmoji(index, `${text} ${hint}`, { mood: options.mood, limit }).filter(
    (entry) => !explained.some((part) => part.key && part.key === entry.key),
  );
  const lines = [];
  if (mode === "only") {
    lines.push(
      "Emoji mode is on: answer with emoji only, no words. Use a varied combo of 2 to 5 emoji whose meanings carry the answer. Do not reuse 😀 😂 ❤️ 👍 🔥 unless that meaning is exact.",
    );
  } else if (mode === "more") {
    lines.push(
      "Emoji mode is on: use several meaningful emoji in the reply, not one generic face. Combine two or three when one emoji is vague.",
    );
  } else if (mode === "off") {
    lines.push("The partner asked for no emoji. Reply in words only and do not include emoji.");
  } else {
    lines.push("Emoji (Unicode 18). When an emoji fits, pick a specific one. Do not default to 😀 😂 ❤️ 👍 🔥.");
  }
  if (explained.length) {
    lines.push(`They sent: ${explained.map(partLabel).join("; ")}.`);
    if (explained.length >= 2) {
      const combo = explained.map((part) => (part.tone ? `${part.name} (${part.tone})` : part.name)).join(" + ");
      lines.push(`Read the combo as ${combo}.`);
    }
  }
  let textOut = lines.join("\n");
  if (mode !== "off") {
    let count = palette.length;
    while (count > 0) {
      const line = `Palette: ${palette
        .slice(0, count)
        .map((entry) => `${entry.emoji} ${entry.name}`)
        .join("; ")}.`;
      const next = `${textOut}\n${line}`;
      if (next.length <= max) {
        textOut = next;
        break;
      }
      count -= 1;
    }
  }
  if (textOut.length > max) textOut = textOut.slice(0, max);
  return textOut;
}

export function emojiModePath(dataDir) {
  return path.join(dataDir, "memory", "emoji-mode.json");
}

export function readEmojiMode(dataDir, fsImpl = fs) {
  if (!dataDir) return null;
  try {
    const body = JSON.parse(fsImpl.readFileSync(emojiModePath(dataDir), "utf8"));
    return body?.mode === "only" || body?.mode === "more" || body?.mode === "off" ? body.mode : null;
  } catch {
    return null;
  }
}

export function writeEmojiMode(dataDir, mode, fsImpl = fs) {
  if (!dataDir) return false;
  if (mode !== "only" && mode !== "more" && mode !== "off") return false;
  try {
    const file = emojiModePath(dataDir);
    fsImpl.mkdirSync(path.dirname(file), { recursive: true });
    const temp = `${file}.tmp`;
    fsImpl.writeFileSync(temp, JSON.stringify({ v: 1, mode }) + "\n");
    fsImpl.renameSync(temp, file);
    return true;
  } catch {
    return false;
  }
}

function isRoomPrompt(json) {
  const system = (json.messages || []).find((message) => message && message.role === "system");
  return typeof system?.content === "string" && system.content.includes("living in your partner's room");
}

/**
 * Insert one short emoji note after the persona. Room barks keep their cached
 * prompt. A mode the partner asked for is remembered when dataDir or memory
 * is passed, so a later turn stays in that mode after history is trimmed.
 */
export function withEmoji(raw, options = {}) {
  let json;
  try {
    json = JSON.parse(Buffer.isBuffer(raw) ? raw.toString("utf8") : String(raw));
  } catch {
    return raw;
  }
  if (!json || !Array.isArray(json.messages) || isRoomPrompt(json)) return raw;
  const lastUser = [...json.messages].reverse().find((message) => message && message.role === "user" && typeof message.content === "string");
  if (!lastUser) return raw;
  let index;
  try {
    index = options.index || getEmojiIndex();
  } catch {
    return raw;
  }
  const fromMessages = emojiModeFromMessages(json.messages);
  let mode = fromMessages;
  if (fromMessages) {
    if (options.memory) options.memory.mode = fromMessages;
    if (options.dataDir) writeEmojiMode(options.dataDir, fromMessages, options.fsImpl);
  } else if (options.memory && (options.memory.mode === "only" || options.memory.mode === "more" || options.memory.mode === "off")) {
    mode = options.memory.mode;
  } else if (options.dataDir) {
    mode = readEmojiMode(options.dataDir, options.fsImpl);
  }
  const block = buildEmojiPrompt({
    index,
    text: lastUser.content,
    mood: options.mood,
    mode,
  });
  if (!String(block || "").trim()) return raw;
  const messages = json.messages.slice();
  const firstSystem = messages.findIndex((message) => message && message.role === "system");
  messages.splice(firstSystem >= 0 ? firstSystem + 1 : 0, 0, { role: "system", content: block });
  json.messages = messages;
  return Buffer.from(JSON.stringify(json));
}
