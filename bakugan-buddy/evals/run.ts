#!/usr/bin/env node
/**
 * Eval runner — calls Home Studio /v1/chat and prints a scorecard.
 *
 *   STUDIO_URL=http://127.0.0.1:8787 npx --yes tsx evals/run.ts
 *   npx --yes tsx evals/run.ts --cases smoke.jsonl
 *   npx --yes tsx evals/run.ts --cases conversations.jsonl --fail-below 0.7
 *
 * Mood tags are scored via @bakugan-buddy/mood (legacy aliases allowed).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeMood, parseTagged, type Mood } from "../packages/mood/src/index.ts";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const STUDIO = process.env.STUDIO_URL || "http://127.0.0.1:8787";

type Case = {
  id: string;
  category: string;
  user: string;
  expectMood: string[];
  require?: string[];
  ban?: string[];
  maxChars?: number;
};

type Row = {
  id: string;
  category: string;
  pass: boolean;
  mood: Mood | null;
  reply: string;
  checks: { mood: boolean; require: boolean; ban: boolean; length: boolean };
  detail: string[];
};

function args() {
  const a = process.argv.slice(2);
  let casesFile = path.join(ROOT, "conversations.jsonl");
  let failBelow = 0.85;
  for (let i = 0; i < a.length; i++) {
    if (a[i] === "--cases" && a[i + 1]) {
      casesFile = path.resolve(ROOT, a[++i]!);
    } else if (a[i] === "--fail-below" && a[i + 1]) {
      failBelow = Number(a[++i]);
    }
  }
  return { casesFile, failBelow };
}

function loadCases(file: string): Case[] {
  return fs
    .readFileSync(file, "utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Case);
}

async function studioChat(user: string): Promise<string> {
  const r = await fetch(`${STUDIO}/v1/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: user }),
  });
  if (!r.ok) {
    const err = await r.text();
    throw new Error(`studio_${r.status}: ${err}`);
  }
  let full = "";
  const reader = r.body!.getReader();
  const dec = new TextDecoder();
  let buf = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.trim()) continue;
      const ev = JSON.parse(line);
      if (ev.type === "token") full += ev.text;
    }
  }
  return full.trim();
}

function score(c: Case, reply: string): Row {
  const parsed = parseTagged(reply);
  const mood = parsed.complete ? parsed.mood : null;
  const speakable = parsed.text || reply;
  const expect = (c.expectMood || []).map((m) => normalizeMood(m));
  const moodOk = mood != null && expect.includes(mood);
  const requireOk = (c.require || []).every((w) =>
    speakable.toLowerCase().includes(w.toLowerCase()),
  );
  const banHit = (c.ban || []).filter((w) =>
    speakable.toLowerCase().includes(w.toLowerCase()),
  );
  const banOk = banHit.length === 0;
  const max = c.maxChars ?? 240;
  const lengthOk = speakable.length <= max;
  const detail: string[] = [];
  if (!moodOk) detail.push(`mood ${mood ?? "∅"} ∉ [${expect.join(",")}]`);
  if (!requireOk) detail.push(`missing require`);
  if (!banOk) detail.push(`banned: ${banHit.join("|")}`);
  if (!lengthOk) detail.push(`len ${speakable.length}>${max}`);
  const pass = moodOk && requireOk && banOk && lengthOk;
  return {
    id: c.id,
    category: c.category,
    pass,
    mood,
    reply: speakable.slice(0, 120),
    checks: { mood: moodOk, require: requireOk, ban: banOk, length: lengthOk },
    detail,
  };
}

function printScorecard(rows: Row[], file: string) {
  const passN = rows.filter((r) => r.pass).length;
  const rate = rows.length ? passN / rows.length : 0;
  console.log(`\n=== Bakugan Buddy eval scorecard ===`);
  console.log(`cases: ${path.basename(file)}  studio: ${STUDIO}`);
  console.log(`pass: ${passN}/${rows.length} (${(rate * 100).toFixed(0)}%)\n`);
  console.log(
    "id".padEnd(14),
    "cat".padEnd(18),
    "mood".padEnd(10),
    "M R B L",
    "result",
  );
  console.log("-".repeat(72));
  for (const r of rows) {
    const flags = [
      r.checks.mood ? "✓" : "✗",
      r.checks.require ? "✓" : "✗",
      r.checks.ban ? "✓" : "✗",
      r.checks.length ? "✓" : "✗",
    ].join(" ");
    console.log(
      r.id.padEnd(14),
      r.category.padEnd(18),
      String(r.mood ?? "—").padEnd(10),
      flags,
      r.pass ? "PASS" : `FAIL ${r.detail.join("; ")}`,
    );
  }
  console.log("-".repeat(72));
  return rate;
}

async function main() {
  const { casesFile, failBelow } = args();
  const cases = loadCases(casesFile);
  // health
  try {
    const h = await fetch(`${STUDIO}/v1/health`).then((r) => r.json());
    if (!h?.llm?.ready) {
      console.error("Studio LLM not ready. Start mock-llama or llama-server, then studio.");
      process.exit(2);
    }
  } catch (err) {
    console.error("Cannot reach studio at", STUDIO, err);
    process.exit(2);
  }

  const rows: Row[] = [];
  for (const c of cases) {
    try {
      const reply = await studioChat(c.user);
      rows.push(score(c, reply));
    } catch (err) {
      rows.push({
        id: c.id,
        category: c.category,
        pass: false,
        mood: null,
        reply: "",
        checks: { mood: false, require: false, ban: false, length: false },
        detail: [String(err)],
      });
    }
  }
  const rate = printScorecard(rows, casesFile);
  if (rate < failBelow) {
    console.error(`\nFAIL: pass rate ${(rate * 100).toFixed(0)}% < ${(failBelow * 100).toFixed(0)}%`);
    process.exit(1);
  }
  console.log(`\nOK: pass rate ${(rate * 100).toFixed(0)}% ≥ ${(failBelow * 100).toFixed(0)}%`);
}

main();
