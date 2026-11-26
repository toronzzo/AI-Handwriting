#!/usr/bin/env node
/**
 * Preyas Exam runner.
 *
 * Sends each question to the brain's own chat endpoint, so memory recall and
 * the persona are exactly what the app gets, then scores the answer on four
 * things: facts it had to contain, contradictions with the notes, numbers it
 * invented, and what it cost in tokens and seconds.
 *
 *   node evals/preyas-exam/run.mjs
 *   node evals/preyas-exam/run.mjs --limit 10
 *   node evals/preyas-exam/run.mjs --kind decision --fail-below 0.8
 *
 * Results land in results/ next to this file. The token is read from the
 * device's local-token file unless PREYAS_TOKEN is set.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { scoreAnswer, summarize, byKind, numbersIn } from "./score.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DATA = process.env.BAKUGAN_DATA_DIR || "/Volumes/Agent/BakuganBuddy";

/**
 * Every number that appears anywhere in the user's notes. An answer may bring
 * up a sibling fact from another note, so "507.8" here is an invention only if
 * no note at all mentions it.
 */
function loadKnownNumbers() {
  const numbers = new Set();
  const file = path.join(DATA, "memory/notes.jsonl");
  try {
    for (const n of numbersIn(fs.readFileSync(file, "utf8"))) numbers.add(n);
  } catch {
    console.warn(`no notes at ${file}; fabricated numbers fall back to per-item strictness`);
  }
  // The brain can also see the model files on the drive, so an answer that
  // quotes "507.8 MB" or "8.4 GB" is reporting a real file, not inventing one.
  for (const bytes of modelSizes(path.join(DATA, "models"))) {
    numbers.add((bytes / 1024 / 1024).toFixed(1));
    numbers.add((bytes / 1024 / 1024 / 1024).toFixed(1));
  }
  return [...numbers];
}

function modelSizes(dir, depth = 0) {
  const sizes = [];
  if (depth > 3) return sizes;
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return sizes;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) sizes.push(...modelSizes(full, depth + 1));
    else if (entry.name.toLowerCase().endsWith(".gguf")) {
      try {
        sizes.push(fs.statSync(full).size);
      } catch {
        /* a dangling symlink is simply not a known size */
      }
    }
  }
  return sizes;
}

function parseArgs(argv) {
  const out = {
    exam: path.join(HERE, "exam.jsonl"),
    base: process.env.PREYAS_BASE || "http://127.0.0.1:8788",
    model: "local",
    tokenFile: path.join(DATA, "memory/local-token"),
    outDir: path.join(HERE, "results"),
    limit: 0,
    kind: "",
    timeoutMs: 120_000,
    failBelow: null,
  };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    const value = () => {
      const next = argv[++i];
      if (next === undefined) throw new Error(`${flag} needs a value`);
      return next;
    };
    if (flag === "--exam") out.exam = value();
    else if (flag === "--base") out.base = value();
    else if (flag === "--model") out.model = value();
    else if (flag === "--token-file") out.tokenFile = value();
    else if (flag === "--out") out.outDir = value();
    else if (flag === "--limit") out.limit = Number(value());
    else if (flag === "--kind") out.kind = value();
    else if (flag === "--timeout") out.timeoutMs = Number(value());
    else if (flag === "--fail-below") out.failBelow = Number(value());
    else throw new Error(`unknown flag ${flag}`);
  }
  return out;
}

function loadExam(file) {
  return String(fs.readFileSync(file, "utf8"))
    .split("\n")
    .filter((line) => line.trim())
    .map((line, n) => {
      try {
        return JSON.parse(line);
      } catch (error) {
        throw new Error(`${file}:${n + 1} is not JSON (${error.message})`);
      }
    });
}

function readToken(file) {
  if (process.env.PREYAS_TOKEN) return process.env.PREYAS_TOKEN.trim();
  try {
    return String(fs.readFileSync(file, "utf8")).trim();
  } catch {
    return "";
  }
}

async function ask(opts, token, item) {
  const started = performance.now();
  const headers = { "Content-Type": "application/json" };
  if (token) headers["X-Preyas-Token"] = token;
  const res = await fetch(`${opts.base.replace(/\/$/, "")}/v1/chat/completions`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model: opts.model,
      stream: false,
      messages: [{ role: "user", content: item.question }],
    }),
    signal: AbortSignal.timeout(opts.timeoutMs),
  });
  const text = await res.text();
  const seconds = (performance.now() - started) / 1000;
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`not JSON: ${text.slice(0, 200)}`);
  }
  const answer = json?.choices?.[0]?.message?.content;
  if (typeof answer !== "string") throw new Error("no message content");
  return { answer, seconds, tokens: Number(json?.usage?.total_tokens) || 0 };
}

const pad = (value, width) => String(value).padEnd(width);
const num = (value, width) => String(value).padStart(width);

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const exam = loadExam(opts.exam).filter((item) => !opts.kind || item.kind === opts.kind);
  const items = opts.limit > 0 ? exam.slice(0, opts.limit) : exam;
  if (!items.length) throw new Error("no items to run");
  const token = readToken(opts.tokenFile);
  const known = loadKnownNumbers();
  console.log(`Preyas Exam · ${items.length} items · ${opts.base} · model ${opts.model}`);
  console.log(`token ${token ? "loaded" : "MISSING (expect 401s)"}\n`);

  const rows = [];
  for (const [index, item] of items.entries()) {
    const tag = `[${String(index + 1).padStart(2)}/${items.length}]`;
    let row;
    try {
      const { answer, seconds, tokens } = await ask(opts, token, item);
      const scored = scoreAnswer({
        answer,
        must: item.must || [],
        any: item.any || [],
        mustNot: item.mustNot || [],
        allow: item.allow || [],
        source: item.source || "",
        known,
      });
      row = {
        id: item.id,
        kind: item.kind,
        question: item.question,
        answer,
        tokens,
        seconds: Math.round(seconds * 10) / 10,
        ...scored,
      };
    } catch (error) {
      row = { id: item.id, kind: item.kind, question: item.question, error: String(error.message || error) };
    }
    rows.push(row);
    if (row.error) {
      console.log(`${tag} ERROR ${row.id}: ${row.error}`);
      continue;
    }
    const marks = row.pass ? "PASS" : "fail";
    const bad = row.contradictions.length + row.fabricated.length;
    console.log(
      `${tag} ${marks} ${num(`${row.facts.found}/${row.facts.total}`, 5)} facts  ${num(bad, 2)} bad  ` +
        `${num(row.tokens, 5)} tok  ${num(row.seconds.toFixed(1), 6)}s  ${row.id}`,
    );
    if (!row.pass) {
      const why = [];
      if (row.facts.missing.length) why.push(`missing ${row.facts.missing.join(", ")}`);
      const missedGroups = row.facts.groups.filter((g) => !g.hit).map((g) => g.group.join(" | "));
      if (missedGroups.length) why.push(`missing any(${missedGroups.join("; ")})`);
      if (row.contradictions.length) why.push(`contradicts ${row.contradictions.join(", ")}`);
      if (row.fabricated.length) why.push(`invented ${row.fabricated.join(", ")}`);
      console.log(`            ${why.join(" · ")}`);
    }
  }

  const summary = summarize(rows);
  console.log("\nkind        n   facts  pass  contra  fab   med s    tok");
  for (const k of byKind(rows)) {
    console.log(
      `${pad(k.kind, 10)} ${num(k.count, 3)}  ${num(k.factScore.toFixed(2), 5)}  ` +
        `${num(k.passRate.toFixed(2), 4)}  ${num(k.itemsWithContradiction, 6)}  ${num(k.itemsWithFabricatedNumber, 3)}  ` +
        `${num(k.meanSeconds.toFixed(1), 6)}  ${num(Math.round(k.meanTokens), 6)}`,
    );
  }
  console.log(
    `${pad("ALL", 10)} ${num(summary.count, 3)}  ${num(summary.factScore.toFixed(2), 5)}  ` +
      `${num(summary.passRate.toFixed(2), 4)}  ${num(summary.itemsWithContradiction, 6)}  ` +
      `${num(summary.itemsWithFabricatedNumber, 3)}  ${num(summary.meanSeconds.toFixed(1), 6)}  ${num(Math.round(summary.meanTokens), 6)}`,
  );
  if (summary.errors) console.log(`errors: ${summary.errors}`);

  fs.mkdirSync(opts.outDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const file = path.join(opts.outDir, `exam-${stamp}.json`);
  fs.writeFileSync(
    file,
    JSON.stringify({ meta: { ...opts, tokenFile: undefined, startedAt: stamp }, summary, kinds: byKind(rows), rows }, null, 1),
  );
  console.log(`\nwrote ${path.relative(process.cwd(), file)}`);

  if (opts.failBelow !== null && summary.factScore < opts.failBelow) {
    console.log(`fact score ${summary.factScore.toFixed(2)} is below ${opts.failBelow}`);
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 2;
});
