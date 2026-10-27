/**
 * Build system prompt from characters/preyas persona + lore + retrieved examples.
 * Private files (persona.json, lore.md, examples.jsonl) win over *.template.*.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const STUDIO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const CHARACTER_DIR = path.resolve(STUDIO_ROOT, "..", "characters", "preyas");

function readMaybe(...names) {
  for (const name of names) {
    const p = path.join(CHARACTER_DIR, name);
    if (fs.existsSync(p)) return { path: p, text: fs.readFileSync(p, "utf8") };
  }
  return null;
}

export function loadPersona() {
  const hit = readMaybe("persona.json", "persona.template.json");
  if (!hit) {
    return {
      name: "Ripple",
      attribute: "aquos",
      personality: "witty joker, loyal underneath",
      speechStyle: "1-3 short sentences",
      source: "builtin",
    };
  }
  const data = JSON.parse(hit.text);
  return { ...data, source: path.basename(hit.path) };
}

export function loadLore() {
  const hit = readMaybe("lore.md", "lore.template.md");
  return hit ? { text: hit.text.trim(), source: path.basename(hit.path) } : { text: "", source: null };
}

export function loadExamples() {
  const hit = readMaybe("examples.jsonl", "examples.template.jsonl");
  if (!hit) return { rows: [], source: null };
  const rows = hit.text
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
  return { rows, source: path.basename(hit.path) };
}

function tokenize(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2);
}

/** Score examples by token overlap with the latest user text; return top K. */
export function retrieveExamples(userText, rows, k = 8) {
  const q = new Set(tokenize(userText));
  if (!rows.length) return [];
  if (!q.size) return rows.slice(0, k);

  const scored = rows.map((row, i) => {
    const hay = tokenize(`${row.user || ""} ${row.assistant || ""}`);
    let score = 0;
    for (const t of hay) if (q.has(t)) score += 1;
    return { row, score, i };
  });
  scored.sort((a, b) => b.score - a.score || a.i - b.i);
  const picked = scored.filter((s) => s.score > 0).slice(0, k);
  if (picked.length < k) {
    for (const s of scored) {
      if (picked.length >= k) break;
      if (!picked.includes(s)) picked.push(s);
    }
  }
  return picked.slice(0, k).map((s) => s.row);
}

export function buildSystemPrompt({
  partnerName,
  facts,
  form,
  userText,
  characterOverride,
} = {}) {
  const persona = { ...loadPersona(), ...(characterOverride || {}) };
  const lore = loadLore();
  const { rows, source: exSource } = loadExamples();
  const fewshot = retrieveExamples(userText || "", rows, 8);

  const lines = [
    `You are ${persona.name}, a ${persona.attribute || "aquos"}-attribute Bakugan-inspired pocket companion.`,
    persona.personality || "",
    persona.speechStyle ? `Speech style: ${persona.speechStyle}` : "",
    Array.isArray(persona.catchphrases) && persona.catchphrases.length
      ? `Catchphrases (use sparingly): ${persona.catchphrases.join(" / ")}`
      : "",
    Array.isArray(persona.bannedBehaviors) && persona.bannedBehaviors.length
      ? `Never: ${persona.bannedBehaviors.join("; ")}.`
      : "",
    lore.text ? `## Lore\n${lore.text}` : "",
    "Speak in 1-3 short spoken sentences.",
    "EVERY reply MUST start with a mood tag in square brackets, then a space, then the line.",
    "Allowed moods: [neutral] [happy] [excited] [angry] [sad] [surprised] [thinking] [listening] [battle].",
    "Optional: wrap private reasoning in <think>...</think> (never spoken). [amused] is a happy variant.",
    "Never break character. Never say you are an AI unless asked seriously.",
    "Do not mention tools, models, or llama.",
    partnerName ? `Your partner's name is ${partnerName}.` : "You do not know their name yet.",
    form === "battle" ? "You are currently popped open (battle form)." : "You are currently in sphere form.",
    facts?.length ? `You remember: ${facts.slice(-8).join("; ")}.` : "",
  ];

  if (fewshot.length) {
    lines.push("## Example turns (style only — do not copy PLACEHOLDER wording blindly)");
    for (const ex of fewshot) {
      lines.push(`User: ${ex.user}\nAssistant: ${ex.assistant}`);
    }
  }

  return {
    prompt: lines.filter(Boolean).join("\n\n"),
    meta: {
      personaSource: persona.source,
      loreSource: lore.source,
      examplesSource: exSource,
      retrieved: fewshot.length,
    },
  };
}
