/**
 * The Harness runner. It is the only code allowed to start a Harness process,
 * and it starts nothing until the user presses Да on a fresh draft.
 *
 * Flow (slice 13):
 *   draft(goal, chatId)  -> prompt + rough cost + canStart, stores the draft in
 *                           memory, NEVER starts a run
 *   approve(id, "yes")   -> the ONLY start path: re-checks the guard and the
 *                           prompt rules, marks the draft used, takes the file
 *                           lock and runs the adapter in the background
 *   status()             -> what the app polls
 *   stop()               -> stops the adapter, releases the lock
 *
 * Secrets are read from `/Volumes/Agent/agent/secrets/.env` only here, are
 * passed to the adapter's child environment and to `redact()`, and never appear
 * in a route response, an event, a log line, the status or the spend file.
 *
 * Nothing in this folder runs git or gh: the prompt tells Harness the rules,
 * and the repo gives Harness no merge path.
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { appendMessage } from "../chats.mjs";
import { SAFE_ROOT, readTextFile } from "../safeFs.mjs";
import { canStart, hashPrompt, lintPrompt, redact } from "./guard.mjs";
import { buildPrompt, draftTask as draftTaskWithLlama, slugFor, TASK_MAX } from "./promptTemplate.mjs";
import { DEFAULT_MAX_MINUTES } from "./adapter.mjs";
import { recordHarnessSpend } from "./spend.mjs";
import { capUsd, spentTodayUsd } from "../coach/spendGate.mjs";

/** The Generate box accepts at most this many characters. */
export const MAX_GOAL_CHARS = 400;

/** The only secrets file this project reads, relative to /Volumes/Agent. */
export const SECRETS_RELATIVE_PATH = "agent/secrets/.env";

/** The run lock, relative to the data dir. */
export const RUN_LOCK_RELATIVE_PATH = "harness/run.lock";

/** How much of a report the local model is asked to summarise. */
export const REPORT_SUMMARY_INPUT = 4000;

/** The fallback summary is the first this many characters of the report. */
export const SUMMARY_FALLBACK_CHARS = 600;

const noopHub = { emit: () => null };

function positiveNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

/** Parse a `.env` file into { env, values }; comments, blanks and quotes handled. */
export function parseSecretsText(text) {
  const env = {};
  const values = [];
  for (const line of String(text ?? "").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = trimmed.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) continue;
    let value = match[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"') && value.length >= 2) ||
      (value.startsWith("'") && value.endsWith("'") && value.length >= 2)
    ) {
      value = value.slice(1, -1);
    }
    env[match[1]] = value;
    values.push(value);
  }
  return { env, values };
}

/**
 * The default `readSecrets`: ONLY /Volumes/Agent/agent/secrets/.env, through
 * the safe filesystem door. A missing drive or file means "no secrets", never
 * an exception with a value inside it.
 */
export function readSecretsFromDrive() {
  try {
    const file = readTextFile(SECRETS_RELATIVE_PATH, { root: SAFE_ROOT });
    return parseSecretsText(file.text);
  } catch {
    return { env: {}, values: [] };
  }
}

async function secretPayload(readSecrets) {
  let raw;
  try {
    raw = await readSecrets();
  } catch {
    return { env: {}, values: [] };
  }
  if (Array.isArray(raw)) return { env: {}, values: raw.map((item) => String(item ?? "")).filter(Boolean) };
  if (raw && typeof raw === "object") {
    const env = raw.env && typeof raw.env === "object" ? { ...raw.env } : {};
    const values = Array.isArray(raw.values) ? raw.values : Object.values(env);
    return { env, values: values.map((item) => String(item ?? "")).filter(Boolean) };
  }
  return { env: {}, values: [] };
}

function safeUrl(value) {
  const text = String(value ?? "").trim();
  return /^https?:\/\/[^\s]+$/i.test(text) ? text.slice(0, 300) : "";
}

/**
 * The default summary: three short sentences from the local llama about the
 * report. Any failure returns "" and the caller falls back to the report text.
 */
export async function summarizeReport(report, llamaUrl, { fetchImpl = fetch, timeoutMs = 15_000 } = {}) {
  const text = String(report ?? "").trim().slice(0, REPORT_SUMMARY_INPUT);
  if (!text || !llamaUrl) return "";
  try {
    const response = await fetchImpl(`${String(llamaUrl).replace(/\/$/, "")}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "preyas",
        stream: false,
        temperature: 0.2,
        max_tokens: 180,
        chat_template_kwargs: { enable_thinking: false },
        messages: [
          { role: "system", content: "Summarise this coding run in 3 short sentences for the user. Plain text, no preamble." },
          { role: "user", content: text },
        ],
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) return "";
    const json = await response.json();
    return String(json?.choices?.[0]?.message?.content || "").trim();
  } catch {
    return "";
  }
}

/**
 * createHarnessRunner({ dataDir, adapter, hub, now, readSecrets })
 * plus optional test seams: llamaUrl, draftTask, summarize.
 */
export function createHarnessRunner({
  dataDir,
  adapter,
  hub = noopHub,
  now = Date.now,
  readSecrets = readSecretsFromDrive,
  llamaUrl = process.env.LLAMA_URL || "http://127.0.0.1:8790",
  draftTask = (goal) => draftTaskWithLlama(llamaUrl, goal),
  summarize = (report) => summarizeReport(report, llamaUrl),
  env = process.env,
} = {}) {
  if (!dataDir) throw new Error("The drive is not connected.");
  if (!adapter) throw new Error("A Harness adapter is required.");

  const maxMinutes = positiveNumber(env.HARNESS_MAX_MINUTES, DEFAULT_MAX_MINUTES);
  const drafts = new Map();
  /** Last/current run: { id, state, startedAt, summary, prUrl, error }. */
  let run = null;
  /** The in-flight run's stop flag, so a stop() wins over a late adapter result. */
  let active = null;

  const lockPath = () => path.join(dataDir, RUN_LOCK_RELATIVE_PATH);

  function writeLock(entry) {
    try {
      fs.mkdirSync(path.dirname(lockPath()), { recursive: true });
      fs.writeFileSync(lockPath(), JSON.stringify({ v: 1, runId: entry.runId, startedAt: entry.startedAt }));
    } catch {
      /* the in-memory lock is still authoritative in this process */
    }
  }

  function readLock() {
    try {
      const parsed = JSON.parse(fs.readFileSync(lockPath(), "utf8"));
      if (!parsed || typeof parsed !== "object") return null;
      return { runId: String(parsed.runId || ""), startedAt: Number(parsed.startedAt) || 0 };
    } catch {
      return null;
    }
  }

  function lockFresh(lock) {
    if (!lock) return false;
    return now() - lock.startedAt <= (maxMinutes + 5) * 60_000;
  }

  function releaseLock() {
    try {
      fs.unlinkSync(lockPath());
    } catch {
      /* already gone */
    }
  }

  function runActive() {
    if (run && run.state === "running") return true;
    return lockFresh(readLock());
  }

  function currentRunId() {
    if (run) return run.id;
    const lock = readLock();
    return lock && lockFresh(lock) ? lock.runId : "harness";
  }

  function emit(partial) {
    try {
      hub.emit(partial);
    } catch {
      /* the feed is a nicety; a broken hub never changes a decision */
    }
  }

  function publicDraft(entry) {
    return {
      id: entry.id,
      prompt: entry.prompt,
      hash: entry.hash,
      estimate: entry.estimate,
      createdAt: entry.createdAt,
      startedBy: entry.startedBy,
      used: entry.used,
    };
  }

  function pruneDrafts() {
    if (drafts.size <= 10) return;
    for (const [id, entry] of drafts) {
      if (drafts.size <= 10) break;
      if (entry.used) drafts.delete(id);
    }
  }

  /**
   * draft(goal, chatId): assemble the prompt with code-added header and rules,
   * price it, store it and return the guard's verdict. Never starts a run.
   */
  async function draft(goal, chatId = "") {
    const rawGoal = String(goal ?? "").trim().slice(0, MAX_GOAL_CHARS);
    if (!rawGoal) throw new Error("Type what Harness should build.");
    let taskText = rawGoal;
    try {
      const written = String((await draftTask(rawGoal)) ?? "").trim();
      if (written) taskText = written.slice(0, TASK_MAX);
    } catch {
      taskText = rawGoal;
    }
    const prompt = buildPrompt({ goalText: taskText, slug: slugFor(taskText || rawGoal, now()) });
    let estimate = null;
    try {
      estimate = await adapter.estimate(prompt);
    } catch {
      estimate = null; // a price failure fails closed in the guard
    }
    const entry = {
      id: crypto.randomUUID(),
      prompt,
      hash: hashPrompt(prompt),
      estimate,
      createdAt: now(),
      startedBy: "user-button",
      used: false,
      chatId: String(chatId || ""),
      goal: rawGoal,
    };
    drafts.set(entry.id, entry);
    pruneDrafts();
    const spent = spentTodayUsd(dataDir, new Date(now()));
    const cap = capUsd(dataDir);
    const check = canStart({
      draft: entry,
      now: now(),
      runActive: runActive(),
      spentTodayUsd: spent,
      capUsd: cap,
      estimate,
    });
    return { draft: publicDraft(entry), spentTodayUsd: spent, capUsd: cap, canStart: check };
  }

  /**
   * approve(draftId, answer): "no" discards; "yes" re-checks everything, marks
   * the draft used, takes the lock and runs the adapter in the background.
   */
  async function approve(draftId, answer = "no") {
    const verb = String(answer ?? "").toLowerCase();
    if (verb === "no") {
      const discarded = drafts.delete(String(draftId || ""));
      return { ok: true, discarded, state: run?.state || "idle" };
    }
    if (verb !== "yes") {
      return { ok: false, code: "BAD_ANSWER", reason: 'answer must be "yes" or "no".' };
    }
    const entry = drafts.get(String(draftId || ""));
    const spent = spentTodayUsd(dataDir, new Date(now()));
    const cap = capUsd(dataDir);
    const check = canStart({
      draft: entry,
      now: now(),
      runActive: runActive(),
      spentTodayUsd: spent,
      capUsd: cap,
      estimate: entry?.estimate ?? null,
    });
    if (!check.ok) return { ...check, spentTodayUsd: spent, capUsd: cap };
    const lint = lintPrompt(entry.prompt);
    if (!lint.ok) return lint;
    if (hashPrompt(entry.prompt) !== entry.hash) {
      return { ok: false, code: "DRAFT_CHANGED", reason: "The draft changed after it was priced. Draft it again." };
    }
    entry.used = true;
    const runId = crypto.randomUUID();
    const startedAt = now();
    run = { id: runId, state: "running", startedAt, summary: "", prUrl: "", error: "" };
    active = { stoppedByUser: false };
    writeLock({ runId, startedAt });
    const secrets = await secretPayload(readSecrets);
    void execute(entry, runId, secrets);
    return { ok: true, runId, state: "running", startedAt, spentTodayUsd: spent, capUsd: cap };
  }

  /** The background run: adapters in, activity out, spend and summary after. */
  async function execute(entry, runId, secrets) {
    const state = active;
    const mine = run && run.id === runId ? run : null;
    let outcome = null;
    let startedSomething = true;
    try {
      if (typeof adapter.setSecrets === "function") adapter.setSecrets(secrets.env);
      const cap = capUsd(dataDir);
      const onEvent = (partial) => {
        if (!partial || typeof partial !== "object") return;
        const runningUsd = Number(partial.usd);
        const next = {
          ...partial,
          runId,
          label: redact(partial.label, secrets.values),
          ...(partial.detail === undefined ? {} : { detail: redact(partial.detail, secrets.values) }),
        };
        delete next.usd;
        emit(next);
        // A running cost above the one daily cap stops the run immediately.
        if (!state.stoppedByUser && Number.isFinite(runningUsd) && runningUsd > cap) {
          void stop();
        }
      };
      outcome = await adapter.run(entry.prompt, onEvent);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // Nothing was spawned for a missing CLI, so nothing is charged.
      startedSomething = error?.name !== "HarnessNotConfigured";
      outcome = { ok: false, report: message, usdBasis: "estimate" };
    }
    try {
      const reportText = redact(String(outcome?.report ?? ""), secrets.values).trim();
      if (startedSomething) {
        const actual = Number(outcome?.usd);
        const usd = Number.isFinite(actual) ? actual : Number(entry.estimate?.usdHigh) || 0;
        const basis = Number.isFinite(actual) ? String(outcome.usdBasis || "actual") : "estimate";
        recordHarnessSpend(dataDir, { runId, usd, basis, now: now() });
      }
      let summary = "";
      try {
        summary = String((await summarize(reportText)) ?? "").trim();
      } catch {
        summary = "";
      }
      if (!summary) summary = reportText.replace(/\s+/g, " ").trim().slice(0, SUMMARY_FALLBACK_CHARS);
      if (!summary) {
        summary = outcome?.ok ? "Harness finished without a report." : "Harness stopped before it could report.";
      }
      summary = redact(summary, secrets.values).slice(0, 2000).trim();
      const prUrl = safeUrl(outcome?.prUrl);
      const content = [summary, prUrl, "I did not merge anything."].filter(Boolean).join("\n");
      if (entry.chatId) {
        try {
          appendMessage(dataDir, entry.chatId, {
            role: "assistant",
            who: "preyas",
            model: "harness",
            content,
            t: now(),
          });
        } catch {
          /* a missing chat must not lose the run result */
        }
      }
      if (mine) {
        mine.summary = summary;
        mine.prUrl = prUrl;
        if (state.stoppedByUser) mine.state = "stopped";
        else mine.state = outcome?.ok ? "done" : "error";
        if (mine.state === "error") mine.error = reportText.slice(0, 600);
      }
      emit({
        runId,
        kind: "status",
        tool: "harness",
        label: outcome?.ok ? "Harness finished" : "Harness stopped",
        status: outcome?.ok ? "done" : "stopped",
      });
    } finally {
      // Only this run's lock may be released: stop() and a following run may
      // already own the file by the time the adapter finishes.
      if (readLock()?.runId === runId) releaseLock();
      if (active === state) active = null;
    }
  }

  /** status(): what GET /v1/harness/status returns. */
  function status() {
    const lock = readLock();
    const lockRunning = !(run && run.state === "running") && lockFresh(lock);
    const state = run ? run.state : lockRunning ? "running" : "idle";
    return {
      state,
      runId: run ? run.id : lockRunning ? lock.runId : "",
      startedAt: run ? run.startedAt : lockRunning ? lock.startedAt : 0,
      adapter: String(adapter.name || "not-configured"),
      spentTodayUsd: spentTodayUsd(dataDir, new Date(now())),
      capUsd: capUsd(dataDir),
      ...(run?.summary ? { summary: run.summary } : {}),
      ...(run?.prUrl ? { prUrl: run.prUrl } : {}),
    };
  }

  /** stop(): safe with nothing running; also the cap and timeout path. */
  async function stop() {
    const current = run;
    if (active) active.stoppedByUser = true;
    try {
      if (typeof adapter.stop === "function") await adapter.stop();
    } catch {
      /* the run is over either way */
    }
    if (current && current.state === "running") current.state = "stopped";
    releaseLock();
    emit({
      runId: currentRunId(),
      kind: "status",
      tool: "harness",
      label: "Harness stopped",
      status: "stopped",
    });
    return { ok: true, state: current?.state || "idle" };
  }

  return { draft, approve, status, stop };
}
