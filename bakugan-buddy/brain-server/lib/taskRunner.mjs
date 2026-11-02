/**
 * Runs a task one step at a time with the local model. Each step may use a safe
 * tool (notes, list, read) before the model writes its short result, and the
 * task file is saved after every step so a restart can resume.
 */
import { parsePlan } from "../../packages/alive/src/tasks.ts";
import { searchNotes } from "./notes.mjs";
import { listDir, readTextFile } from "./safeFs.mjs";
import { saveTask } from "./tasks.mjs";

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

/** Context for one step: its tool result plus a few related notes. */
export function stepContext(root, task, step, options = {}) {
  const { fsRoot, searchNotesImpl = searchNotes } = options;
  const chunks = [];
  const tool = step.tool;
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
      chunks.push(`Tool error: ${error instanceof Error ? error.message : String(error)}`);
    }
  } else if (tool && tool.name === "read_file") {
    try {
      const file = readTextFile(tool.path, { root: fsRoot });
      chunks.push(`File ${file.path}:\n${file.text.slice(0, 6000)}`);
    } catch (error) {
      chunks.push(`Tool error: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  const related = searchNotesImpl(root, step.text, 3);
  if (related.length) chunks.push(`Related notes:\n${related.map((n) => `- ${n.text}`).join("\n")}`);
  return chunks.join("\n\n");
}

export async function runTask(root, task, options = {}) {
  const { llamaUrl, fetchImpl = fetch, fsRoot, searchNotesImpl } = options;
  task.status = "running";
  for (const step of task.steps) {
    if (step.status === "done") continue;
    step.status = "running";
    task.updated = Date.now();
    saveTask(root, task);
    try {
      const context = stepContext(root, task, step, { fsRoot, searchNotesImpl });
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
