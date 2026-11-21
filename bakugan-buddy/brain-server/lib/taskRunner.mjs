/**
 * Runs a task one step at a time with the local model. Each step may use a safe
 * tool (notes, list, read) before the model writes its short result, and the
 * task file is saved after every step so a restart can resume.
 */
import { parsePlan } from "../../packages/alive/src/tasks.ts";
import { searchNotes } from "./notes.mjs";
import { listDir, readTextFile } from "./safeFs.mjs";
import { saveTask } from "./tasks.mjs";
import { llamaJudge, reviewAction } from "./os/guard.mjs";
import {
  gatewayChat,
  localChat,
  runToolLoop,
  toGatewayMessages,
  toLocalMessages,
  trimLocalLog,
} from "./os/toolLoop.mjs";
import { toOpenAiTools } from "./os/mcp.mjs";
import { appendTaskSpend, capUsd, spentTodayUsd } from "./coach/spendGate.mjs";
import { sharedBrain } from "./os/neurons.mjs";

const PLAN_SYSTEM = [
  "You plan small tasks for Preyas, a careful assistant.",
  "Reply with one JSON array of 2 to 6 steps and nothing else.",
  'Each step is {"text": "one short instruction", "tool": null} or a tool call:',
  '{"name":"search_notes","query":"..."}, {"name":"list_files","path":"..."}, {"name":"read_file","path":"..."}.',
  "Use a tool only when the step needs notes or files. Every path must be under /Volumes/Agent.",
].join("\n");

const STEP_SYSTEM = [
  "You are Preyas, a careful assistant completing one step of a task.",
  "Reply with the step's result only: one to three sentences, no preamble, no lists, no markdown headings.",
  "Use the context you are given. If it does not contain the answer, say plainly that you could not find it.",
].join("\n");

export function stripThinking(text) {
  return String(text ?? "")
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/<\/?think[^>]*>/gi, "")
    .trim();
}

async function askLlama(llamaUrl, messages, { fetchImpl = fetch, timeoutMs = 60000, maxTokens = 400 } = {}) {
  const body = {
    model: "preyas",
    stream: false,
    temperature: 0,
    max_tokens: maxTokens,
    chat_template_kwargs: { enable_thinking: false },
    messages,
  };
  const res = await fetchImpl(`${llamaUrl}/v1/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`local model answered ${res.status}`);
  const json = await res.json();
  return stripThinking(json?.choices?.[0]?.message?.content || "");
}

/** Ask the model for a plan; fall back to a single step if it answers badly. */
export async function planTask(llamaUrl, title, seed = "", options = {}) {
  const user = `Request: ${title}\n${seed ? `Notes that may help:\n${seed}` : ""}\n\n/no_think`;
  const raw = await askLlama(
    llamaUrl,
    [
      { role: "system", content: PLAN_SYSTEM },
      { role: "user", content: user },
    ],
    { ...options, maxTokens: 420 },
  );
  const steps = parsePlan(raw);
  if (steps.length) return steps;
  return [{ text: title, tool: null }];
}

/** The activity tool id and the one-line detail for a step's tool. */
function toolDetail(tool) {
  if (tool.name === "search_notes") return { name: "search_notes", detail: String(tool.query || "") };
  return { name: String(tool.name), detail: String(tool.path || "") };
}

/**
 * Tell the Activity hub a step started and how it ended. `onActivity` is a
 * hub, a { begin } object or a function; without one nothing happens.
 * A tool that failed says so ("error"), it never claims to have worked.
 */
function activityStep(onActivity, runId, tool) {
  const noop = { done() {}, fail() {}, stop() {} };
  if (!onActivity || !tool || !tool.name) return noop;
  const spec = toolDetail(tool);
  try {
    if (typeof onActivity.begin === "function") return onActivity.begin(runId, spec.name, spec.detail);
    if (typeof onActivity === "function") {
      const started = onActivity({ tool: spec.name, detail: spec.detail, runId, status: "running" }) || {};
      return {
        done: () => onActivity({ ...started, tool: spec.name, detail: spec.detail, runId, status: "done" }),
        fail: () => onActivity({ ...started, tool: spec.name, detail: spec.detail, runId, status: "error" }),
        stop: () => onActivity({ ...started, tool: spec.name, detail: spec.detail, runId, status: "stopped" }),
      };
    }
  } catch {
    /* the feed is a nicety; a task never fails because of it */
  }
  return noop;
}

/** Context for one step: its tool result plus a few related notes. */
export function stepContext(root, task, step, options = {}) {
  const { fsRoot, searchNotesImpl = searchNotes, onActivity, runId = String(task?.id || "") } = options;
  const chunks = [];
  const tool = step.tool;
  const mark = tool && tool.name ? activityStep(onActivity, runId, tool) : null;
  let failed = false;
  if (tool && tool.name === "search_notes") {
    const hits = searchNotesImpl(root, tool.query, 5);
    chunks.push(`Notes matching "${tool.query}":\n${hits.length ? hits.map((n) => `- ${n.text}`).join("\n") : "none"}`);
  } else if (tool && tool.name === "list_files") {
    try {
      const listing = listDir(tool.path, { root: fsRoot });
      chunks.push(
        `Files in ${listing.path}:\n${listing.entries.map((entry) => (entry.dir ? `${entry.name}/` : entry.name)).join("\n")}`,
      );
    } catch (error) {
      failed = true;
      chunks.push(`Tool error: ${error instanceof Error ? error.message : String(error)}`);
    }
  } else if (tool && tool.name === "read_file") {
    try {
      const file = readTextFile(tool.path, { root: fsRoot });
      chunks.push(`File ${file.path}:\n${file.text.slice(0, 6000)}`);
    } catch (error) {
      failed = true;
      chunks.push(`Tool error: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  if (mark) {
    if (failed) mark.fail();
    else mark.done();
  }
  const related = searchNotesImpl(root, step.text, 3);
  if (related.length) chunks.push(`Related notes:\n${related.map((n) => `- ${n.text}`).join("\n")}`);
  return chunks.join("\n\n");
}

const runningTasks = new Set();

export function taskRunActive(id) {
  return runningTasks.has(String(id));
}

/**
 * Start one runner per task id. A second resume while the first is still
 * waiting on a model returns null instead of doubling model calls.
 */
export function launchTaskRun(root, task, options = {}) {
  const id = String(task?.id || "");
  if (!id || runningTasks.has(id)) return null;
  runningTasks.add(id);
  const run = task?.toolLoop ? runToolTask(root, task, options) : runTask(root, task, options);
  return run.finally(() => {
    runningTasks.delete(id);
  });
}

// ---------------------------------------------------------------------------
// Tool-loop tasks (MCP): plan, one tool call per step, final answer.
// ---------------------------------------------------------------------------

const SEARCH_NOTES_SPEC = {
  name: "search_notes",
  description: "Search your saved notes (BM25). Use it when the request mentions your notes or memories.",
  parameters: { type: "object", properties: { query: { type: "string", description: "What to search for" } }, required: ["query"] },
};

/** Open Yes/No confirmations, one per (task, step), resolved by the confirm route. */
const confirmWaiters = new Map();

/**
 * Answer a pending confirmation. Validates the single-use token and the
 * deadline; resolves the running loop when there is one. Never executes
 * anything itself.
 */
export function confirmTaskStep(task, stepId, { yes, token, now = () => Date.now() } = {}) {
  const id = Number(stepId);
  const step = (task?.steps || []).find((row) => Number(row.id) === id);
  const pending = step?.pendingConfirm;
  if (!step || !pending) return { ok: false, error: "no pending confirmation for this step" };
  if (pending.answered) return { ok: false, error: "this step was already answered" };
  if (now() > Number(pending.expiresAt)) {
    pending.answered = "expired";
    const waiter = confirmWaiters.get(`${task.id}:${id}`);
    if (waiter) {
      confirmWaiters.delete(`${task.id}:${id}`);
      waiter.resolve("expired");
    }
    return { ok: false, error: "expired" };
  }
  if (String(token || "") !== String(pending.token || "")) return { ok: false, error: "bad token" };
  pending.answered = yes ? "yes" : "no";
  const waiter = confirmWaiters.get(`${task.id}:${id}`);
  if (waiter) {
    confirmWaiters.delete(`${task.id}:${id}`);
    waiter.resolve(yes ? "yes" : "no");
  }
  return { ok: true, decision: yes ? "yes" : "no" };
}

/**
 * Run a tool-loop task. Tool tasks use DeepSeek Flash through the gateway on
 * :4000 (it handles tool calls well); when the gateway is down or the daily
 * spend cap is reached, the run falls back to the local Qwen3-8B in strict
 * JSON mode. Never Kimi. Every tool call goes through the Сторож guard and
 * its audit log; "ask" verdicts pause the task until the Yes/No confirm
 * route answers.
 */
export async function runToolTask(root, task, options = {}) {
  const {
    llamaUrl,
    gatewayUrl,
    fetchImpl = fetch,
    hub = null,
    guard = reviewAction,
    judge,
    fsRoot,
    repoRoot,
    onActivity,
    maxSteps,
    confirmTtlMs,
    now = () => Date.now(),
    searchNotesImpl = searchNotes,
    onLog = () => {},
    brain = null,
  } = options;
  const modelJudge = judge !== undefined ? judge : llamaUrl ? llamaJudge({ llamaUrl, fetchImpl }) : null;

  let specs = [];
  if (hub && typeof hub.listTools === "function") {
    try {
      specs = await hub.listTools();
    } catch (error) {
      onLog(`mcp: tool list failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  if (!specs.some((spec) => spec.name === "search_notes")) specs.unshift(SEARCH_NOTES_SPEC);

  let mode = "gateway";
  let totalUsd = 0;

  const overCap = () => {
    try {
      const at = new Date(typeof now === "function" ? now() : Date.now());
      return spentTodayUsd(root, at) >= capUsd(root);
    } catch {
      return false;
    }
  };

  const callModel = async (log, { allowTools }) => {
    if (mode === "gateway") {
      try {
        if (overCap()) throw new Error("daily limit reached; using the local model");
        const result = await gatewayChat({
          gatewayUrl,
          fetchImpl,
          messages: toGatewayMessages(log),
          tools: allowTools ? toOpenAiTools(specs) : undefined,
        });
        const promptTokens = Number(result.usage?.prompt_tokens) || 0;
        const completionTokens = Number(result.usage?.completion_tokens) || 0;
        totalUsd += (promptTokens * 0.15 + completionTokens * 0.6) / 1_000_000;
        return { ...result, model: "deepseek-flash" };
      } catch (error) {
        mode = "local";
        onLog(`mcp: gateway failed (${error instanceof Error ? error.message : String(error)}); using the local model`);
      }
    }
    const result = await localChat({ llamaUrl, fetchImpl, messages: toLocalMessages(trimLocalLog(log), specs) });
    return { ...result, model: "preyas" };
  };

  const review = (action) =>
    guard(action, {
      dataDir: root,
      fsRoot,
      repoRoot,
      judge: modelJudge,
      now,
    });

  const execute = async (name, args) => {
    if (name === "search_notes") {
      const hits = searchNotesImpl(root, String((args && args.query) || ""), 5);
      return hits.length ? hits.map((note) => `- ${note.text}`).join("\n") : "no notes found";
    }
    if (!hub || typeof hub.callTool !== "function") throw new Error("tools are not available");
    return hub.callTool(name, args);
  };

  const confirm = (current, step, pending) =>
    new Promise((resolve) => {
      const key = `${current.id}:${step.id}`;
      let settled = false;
      const finish = (value) => {
        if (!settled) {
          settled = true;
          confirmWaiters.delete(key);
          resolve(value);
        }
      };
      confirmWaiters.set(key, { resolve: finish });
      const ttl = Math.max(1_000, Number(pending.expiresAt) - (typeof now === "function" ? now() : Date.now()));
      setTimeout(() => finish("expired"), ttl);
    });

  task.status = "running";
  task.updated = Date.now();
  saveTask(root, task);

  try {
    await runToolLoop(task, {
      callModel,
      review,
      execute,
      confirm,
      save: () => saveTask(root, task),
      activity: onActivity,
      maxSteps,
      confirmTtlMs,
      now,
      onLog,
      brain: brain ?? sharedBrain(),
    });
  } catch (error) {
    // Both models down, or the loop itself broke: record it, never hang "running".
    task.status = "error";
    task.steps = [
      ...(task.steps || []),
      {
        id: (task.steps ? task.steps.length : 0) + 1,
        text: "The run failed",
        status: "error",
        result: error instanceof Error ? error.message : String(error),
        tool: null,
      },
    ];
    task.updated = Date.now();
    saveTask(root, task);
  }

  if (totalUsd > 0) {
    try {
      appendTaskSpend(root, totalUsd, new Date(typeof now === "function" ? now() : Date.now()));
    } catch {
      /* spend logging is best effort */
    }
  }
  return task;
}

export async function runTask(root, task, options = {}) {
  const id = String(task?.id || "");
  const { llamaUrl, fetchImpl = fetch, fsRoot, searchNotesImpl, guard = reviewAction, judge, onActivity } = options;
  const modelJudge =
    judge !== undefined
      ? judge
      : llamaUrl
        ? llamaJudge({ llamaUrl, fetchImpl })
        : null;
  task.status = "running";
  for (const step of task.steps) {
    if (step.status === "done") continue;
    step.status = "running";
    task.updated = Date.now();
    saveTask(root, task);

    // Сторож: every tool call is reviewed before it runs. A block (or an
    // "ask" without a confirm card in tasks) ends the step with an
    // explanation; the task goes on.
    if (step.tool && step.tool.name) {
      const action = {
        kind: String(step.tool.name),
        args:
          step.tool.name === "search_notes"
            ? { query: String(step.tool.query || "") }
            : { path: String(step.tool.path || "") },
        userRequest: String(task.title || "").slice(0, 500),
        origin: "user",
        source: "task",
      };
      const review = await guard(action, {
        dataDir: root,
        fsRoot,
        judge: modelJudge,
        now: () => Date.now(),
      });
      if (review.verdict !== "allow") {
        step.result =
          review.verdict === "block" ? `Blocked by the guard: ${review.why}` : "Blocked by the guard: needs your OK";
        step.status = "done";
        task.updated = Date.now();
        saveTask(root, task);
        continue;
      }
    }

    try {
      const context = stepContext(root, task, step, { fsRoot, searchNotesImpl, onActivity, runId: id });
      const result = await askLlama(
        llamaUrl,
        [
          { role: "system", content: STEP_SYSTEM },
          {
            role: "user",
            content: `Task: ${task.title}\nStep ${step.id}/${task.steps.length}: ${step.text}\n\nContext:\n${context || "(none)"}\n\n/no_think`,
          },
        ],
        { fetchImpl, maxTokens: 260 },
      );
      step.result = result.slice(0, 1200);
      step.status = "done";
    } catch (error) {
      step.status = "error";
      step.result = error instanceof Error ? error.message : String(error);
      task.status = "error";
      task.updated = Date.now();
      saveTask(root, task);
      return task;
    }
    task.updated = Date.now();
    saveTask(root, task);
  }
  task.status = "done";
  task.updated = Date.now();
  saveTask(root, task);
  return task;
}
