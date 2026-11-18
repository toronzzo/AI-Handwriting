/**
 * Coach skill playbooks: Markdown files with a tiny frontmatter and a fixed
 * step body. No YAML library: frontmatter lists are JSON arrays. A bad regex
 * or a missing field is an ERROR on that skill, never a crash.
 */
import fs from "node:fs";
import path from "node:path";

const FIELD_KEYS = new Set(["Do", "Why", "Command", "Check", "Expect", "Bad", "Fail-hint", "Ack", "Danger"]);

function stripInline(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function parseJsonArray(raw) {
  const text = String(raw ?? "").trim();
  if (!text) return [];
  try {
    const parsed = JSON.parse(text);
    return Array.isArray(parsed) ? parsed.map((item) => String(item)) : [];
  } catch {
    return [];
  }
}

/** /pattern/flags -> { src, re } or { src, re: null } when the regex is bad. */
function parseRegex(raw) {
  const src = String(raw ?? "").trim();
  const match = src.match(/^\/([\s\S]*)\/([a-z]*)$/i);
  if (!match) return { src, re: null, error: `bad regex (no /.../): ${src.slice(0, 60)}` };
  try {
    return { src, re: new RegExp(match[1], match[2] || "") };
  } catch (err) {
    return { src, re: null, error: `bad regex: ${String(err && err.message ? err.message : err)}` };
  }
}

/**
 * Parses one skill file. Never throws: problems land in `errors`. A skill with
 * a missing name or no steps is `ok: false`; a bad Expect regex is reported
 * but the rest of the skill still works.
 */
export function parseSkill(text, file = "skill.md") {
  const errors = [];
  const lines = String(text ?? "").replace(/\r\n/g, "\n").split("\n");
  const skill = {
    file,
    name: "",
    when: [],
    escalateIf: [],
    risk: "low",
    version: "",
    intro: "",
    steps: [],
    checks: [],
    mistakes: [],
    glossary: [],
  };

  let front = null;
  if (lines[0]?.trim() === "---") {
    const end = lines.findIndex((line, index) => index > 0 && line.trim() === "---");
    if (end > 0) front = lines.slice(1, end);
  }
  const bodyStart = front ? (lines.findIndex((line, index) => index > 0 && line.trim() === "---") + 1) : 0;
  const bodyLines = lines.slice(bodyStart);

  if (front) {
    for (const line of front) {
      const match = line.match(/^\s*([A-Za-z_-]+)\s*:\s*([\s\S]*)$/);
      if (!match) continue;
      const [, key, value] = match;
      if (key === "name") skill.name = stripInline(value);
      else if (key === "when") skill.when = parseJsonArray(value);
      else if (key === "escalate_if") skill.escalateIf = parseJsonArray(value);
      else if (key === "risk") skill.risk = stripInline(value) === "danger" ? "danger" : "low";
      else if (key === "version") skill.version = stripInline(value);
    }
  }
  if (!skill.name) {
    errors.push(`${file}: missing frontmatter name`);
    skill.name = path.basename(file, ".md");
  }

  // Split the body into intro, steps, checks, mistakes, glossary.
  let section = "intro";
  let currentStep = null;
  let lastField = null;
  const sectionHeads = { "## Steps": "steps", "## Checks": "checks", "## Common mistakes": "mistakes", "## Glossary": "glossary" };

  for (const raw of bodyLines) {
    const line = raw.trimEnd();
    const trimmed = line.trim();
    if (Object.prototype.hasOwnProperty.call(sectionHeads, trimmed)) {
      section = sectionHeads[trimmed];
      continue;
    }
    if (section === "intro") {
      skill.intro += (skill.intro ? "\n" : "") + trimmed;
      continue;
    }
    if (section === "checks" || section === "mistakes") {
      if (trimmed.startsWith("- ")) skill[section === "checks" ? "checks" : "mistakes"].push(stripInline(trimmed.slice(2)));
      continue;
    }
    if (section === "glossary") {
      const gloss = trimmed.match(/^- (.+?): ([\s\S]*)$/);
      if (gloss) skill.glossary.push({ term: stripInline(gloss[1]), meaning: stripInline(gloss[2]) });
      continue;
    }
    if (section !== "steps") continue;
    const stepHead = line.match(/^###\s+(\d+)\.\s*([\s\S]*)$/);
    if (stepHead) {
      currentStep = {
        n: Number(stepHead[1]) || 0,
        title: stripInline(stepHead[2]),
        do: "",
        why: "",
        commands: [],
        check: "",
        expects: [],
        bads: [],
        failHint: "",
        ack: false,
        danger: false,
      };
      lastField = null;
      skill.steps.push(currentStep);
      continue;
    }
    if (!currentStep) continue;
    const field = line.match(/^(Do|Why|Command|Check|Expect|Bad|Fail-hint|Ack|Danger):\s?([\s\S]*)$/);
    if (field && FIELD_KEYS.has(field[1])) {
      const [, key, value] = field;
      if (key === "Do") { currentStep.do += (currentStep.do ? " " : "") + stripInline(value); lastField = "do"; }
      else if (key === "Why") { currentStep.why += (currentStep.why ? " " : "") + stripInline(value); lastField = "why"; }
      else if (key === "Command") { currentStep.commands.push(stripInline(value)); lastField = "command"; }
      else if (key === "Check") { currentStep.check += (currentStep.check ? " " : "") + stripInline(value); lastField = "check"; }
      else if (key === "Expect") {
        const parsed = parseRegex(value);
        if (parsed.re) currentStep.expects.push(parsed);
        else errors.push(`${file} step ${currentStep.n}: ${parsed.error}`);
        lastField = "expect";
      } else if (key === "Bad") {
        const parsed = parseRegex(value);
        if (parsed.re) currentStep.bads.push(parsed);
        else errors.push(`${file} step ${currentStep.n}: ${parsed.error}`);
        lastField = "bad";
      } else if (key === "Fail-hint") { currentStep.failHint = stripInline(value); lastField = "failHint"; }
      else if (key === "Ack") { currentStep.ack = /yes/i.test(value); lastField = "ack"; }
      else if (key === "Danger") { currentStep.danger = /yes/i.test(value); lastField = "danger"; }
      continue;
    }
    // Continuation line: attach to the last field we saw.
    if (trimmed && lastField) {
      const map = { do: "do", why: "why", check: "check", failHint: "failHint" };
      if (map[lastField]) currentStep[map[lastField]] += " " + stripInline(trimmed);
    }
  }

  for (const step of skill.steps) {
    if (!step.do) errors.push(`${file} step ${step.n}: missing Do`);
    if (!step.check) errors.push(`${file} step ${step.n}: missing Check`);
  }
  if (!skill.steps.length) errors.push(`${file}: no steps`);

  return { ok: errors.length === 0 && skill.steps.length > 0, skill, errors };
}

/**
 * Loads every .md file in `dir`, with an mtime cache so edits show up without
 * a restart. Returns { file, ok, skill, errors } entries, sorted by file name.
 */
export function loadSkills(dir, cache = new Map()) {
  if (!dir || !fs.existsSync(dir)) return [];
  const entries = [];
  for (const name of fs.readdirSync(dir).sort()) {
    if (!name.endsWith(".md")) continue;
    const file = path.join(dir, name);
    let mtimeMs = 0;
    try {
      mtimeMs = fs.statSync(file).mtimeMs;
    } catch {
      continue;
    }
    const cached = cache.get(file);
    if (cached && cached.mtimeMs === mtimeMs) {
      entries.push(cached.entry);
      continue;
    }
    let text = "";
    try {
      text = fs.readFileSync(file, "utf8");
    } catch {
      continue;
    }
    const entry = { file, ...parseSkill(text, name) };
    cache.set(file, { mtimeMs, entry });
    entries.push(entry);
  }
  return entries;
}

/**
 * Copies seed playbooks into the live skills folder, never overwriting
 * existing user files. The seed lessons file only lands when lessons.jsonl
 * does not exist yet.
 */
export function copySeedIfMissing(seedDir, dir) {
  if (!seedDir || !dir || !fs.existsSync(seedDir)) return { copied: [] };
  const copied = [];
  fs.mkdirSync(dir, { recursive: true });
  for (const name of fs.readdirSync(seedDir).sort()) {
    const source = path.join(seedDir, name);
    if (name.endsWith(".md")) {
      const target = path.join(dir, name);
      if (!fs.existsSync(target)) {
        fs.copyFileSync(source, target);
        copied.push(name);
      }
    } else if (name === "lessons.seed.jsonl") {
      const target = path.join(dir, "lessons.jsonl");
      if (!fs.existsSync(target)) {
        fs.copyFileSync(source, target);
        copied.push("lessons.jsonl");
      }
    }
  }
  return { copied };
}
