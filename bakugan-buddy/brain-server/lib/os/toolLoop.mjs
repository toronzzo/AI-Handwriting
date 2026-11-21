/**
 * Preyas's tool loop: plan, then ONE tool call per step, feed the result
 * back, at most TOOL_LOOP_MAX_STEPS steps, stop on a final answer. Pure
 * orchestration: the model calls, the guard, the tool executor and the
 * confirm flow are all injected, so tests run with fakes and no network.
 *
 * Model routing (see taskRunner.mjs, which wires the real callers):
 *   - gateway: DeepSeek Flash through the LiteLLM gateway on :4000, native
 *     OpenAI tool_calls. Never Kimi.
 *   - local: Qwen3-8B on :8790 as a fallback; it answers in a strict JSON
 *     {"tool":...,"args":...} / {"answer":...} shape (no native tool support).
 */
import { TOOL_LOOP_MAX_STEPS } from "../../../packages/alive/src/tasks.ts";
import { paidCostUsd, tokensPerSec } from "./brainUsage.mjs";

export { TOOL_LOOP_MAX_STEPS };

export const MAX_TOOL_RESULT_CHARS = 4_000;
export const MAX_LOCAL_CONTEXT_CHARS = 14_000;

export const TOOL_SYSTEM = [
  "You are Preyas, an Aquos Bakugan and a careful, honest assistant with real tools.",
  "Plan first, then act: use AT MOST ONE tool per reply, wait for its result, and only then continue.",
  "Prefer reading tools; writing, editing, shell commands and browser actions always need your partner's Yes first (the app asks them, not you).",
  "Every file path must be under /Volumes/Agent or inside the repo folder. Never read, write or run anything that mentions secrets, .env, keys or tokens.",
  "When you have enough information, stop calling tools and give ONE final answer: a few short sentences, in the language of the request, with the facts you found.",
  "Never invent a tool result. If a tool failed or was blocked, say so plainly.",
].join("\n");

const FINAL_SYSTEM = [
  "You are Preyas. Your tool steps are used up.",
  "Give your final answer now from what you have learned: a few short sentences, in the language of the request, no tool calls.",
].join("\n");

/** Human one-line label for a tool step, shown in the task panel. */
export function labelForTool(name, args = {}) {
  const text = String(name || "tool");
  const one = (value, max = 90) => {
    const line = String(value ?? "").replace(/\s+/g, " ").trim();
    return line ? (line.length > max ? `${line.slice(0, max)}…` : line) : "";
  };
  if (text === "search_notes") return `Search my notes for "${one(args.query, 60)}"`;
  if (text === "files_list_directory") return `List ${one(args.path)}`;
  if (text === "files_directory_tree") return `Folder tree of ${one(args.path)}`;
  if (text === "files_search_files") return `Find "${one(args.pattern, 40)}" in ${one(args.path)}`;
  if (text === "files_get_file_info") return `Info about ${one(args.path)}`;
  if (text === "files_list_allowed_directories") return "List the allowed folders";
  if (text === "files_read_multiple_files") return `Read ${one(Array.isArray(args.paths) ? args.paths[0] : "")}`;
  if (text.startsWith("files_read")) return `Read ${one(args.path)}`;
  if (text === "files_write_file") return `Write ${one(args.path)}`;
  if (text === "files_edit_file") return `Edit ${one(args.path)}`;
  if (text === "files_create_directory") return `New folder ${one(args.path)}`;
  if (text === "files_move_file") return `Move ${one(args.source)}`;
  if (text === "shell_run") return `Run ${one(args.command, 70)}`;
  if (text === "browser_navigate") return `Open ${one(args.url, 70)}`;
  if (text === "browser_snapshot") return "Read the page";
  if (text === "browser_click") return `Click "${one(args.element, 40)}"`;
  if (text === "browser_type") return `Type into "${one(args.element, 40)}"`;
  if (text === "browser_fill_form") return "Fill a form";
  if (text === "browser_select_option") return "Pick an option";
  if (text === "browser_press_key") return `Press ${one(args.key, 20)}`;
  if (text === "browser_hover") return `Hover "${one(args.element, 40)}"`;
  if (text === "browser_drag") return "Drag and drop";
  if (text === "browser_file_upload") return "Upload a file";
  if (text === "browser_handle_dialog") return "Answer a dialog";
  if (text === "browser_evaluate") return "Run a script in the page";
  if (text === "browser_tabs") return "Manage tabs";
  if (text === "browser_navigate_back") return "Go back";
  if (text === "browser_wait_for") return "Wait for the page";
  if (text === "browser_console_messages") return "Read console messages";
  if (text === "browser_network_requests") return "Read network requests";
  if (text === "browser_take_screenshot") return "Take a screenshot";
  return text;
}

/** The OpenAI tool-call format for one message history entry. */
export function toGatewayMessages(log) {
  const messages = [];
  for (const entry of log) {
    if (entry.kind === "system") messages.push({ role: "system", content: entry.text });
    else if (entry.kind === "user") messages.push({ role: "user", content: entry.text });
    else if (entry.kind === "assistant") messages.push({ role: "assistant", content: entry.text });
    else if (entry.kind === "toolcall") {
      messages.push({
        role: "assistant",
        content: null,
        tool_calls: [
          { id: entry.id || `call_${entry.index ?? 1}`, type: "function", function: { name: entry.name, arguments: JSON.stringify(entry.args ?? {}) } },
        ],
      });
    } else if (entry.kind === "toolresult") {
      messages.push({ role: "tool", tool_call_id: entry.id || `call_${entry.index ?? 1}`, content: entry.text });
    }
  }
  return messages;
}

/** A compact tool list for the local model, which has no native tool calls. */
export function toolListPrompt(specs) {
  const rows = specs.map((spec) => {
    const params = Object.keys((spec.parameters && spec.parameters.properties) || {})
      .filter((key) => spec.parameters.required === undefined || (Array.isArray(spec.parameters.required) && spec.parameters.required.includes(key)))
      .join(", ");
    return `- ${spec.name}(${params}): ${String(spec.description || "").split("\n")[0]}`;
  });
  return rows.join("\n");
}

/** The local model's messages: the tool list rides in the system prompt. */
export function toLocalMessages(log, specs) {
  const out = [];
  for (const entry of log) {
    if (entry.kind === "system") out.push({ role: "system", content: `${entry.text}\n\nAvailable tools:\n${toolListPrompt(specs)}` });
    else if (entry.kind === "user") out.push({ role: "user", content: entry.text });
    else if (entry.kind === "assistant") out.push({ role: "assistant", content: entry.text });
    else if (entry.kind === "toolcall") {
      out.push({ role: "assistant", content: `(I used the tool ${entry.name} with ${JSON.stringify(entry.args ?? {})})` });
    } else if (entry.kind === "toolresult") {
      out.push({ role: "user", content: `Result of ${entry.name}:\n${entry.text}` });
    }
  }
  return out;
}

/**
 * One call to the LiteLLM gateway (DeepSeek Flash) with native tool calls.
 * Returns {answer} or {toolCalls:[{id,name,args}]}, plus usage token counts.
 * Never throws for a model answer we can parse; a network/HTTP failure throws.
 */
export async function gatewayChat({ gatewayUrl, model = "deepseek-flash", messages, tools, fetchImpl = fetch, timeoutMs = 60_000, maxTokens = 1000 } = {}) {
  const url = String(gatewayUrl || process.env.PAID_GATEWAY_URL || "http://127.0.0.1:4000").replace(/\/$/, "");
  const res = await fetchImpl(`${url}/v1/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model,
      messages,
      temperature: 0,
      stream: false,
      max_tokens: maxTokens,
      ...(tools && tools.length ? { tools, tool_choice: "auto" } : {}),
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`gateway answered ${res.status}`);
  const json = await res.json();
  const message = json?.choices?.[0]?.message;
  const usage = json?.usage || {};
  const content = String(message?.content || "").trim();
  const rawCalls = Array.isArray(message?.tool_calls) ? message.tool_calls : [];
  const toolCalls = [];
  for (const call of rawCalls) {
    const fn = call?.function;
    if (!fn || typeof fn.name !== "string") continue;
    let args = {};
    try {
      args = JSON.parse(String(fn.arguments || "{}"));
    } catch {
      args = { _raw: String(fn.arguments || "") };
    }
    if (typeof args !== "object" || args === null) args = {};
    toolCalls.push({ id: String(call.id || ""), name: fn.name, args });
  }
  if (toolCalls.length) return { toolCalls, usage };
  if (content) return { answer: content, usage };
  throw new Error("gateway returned an empty answer");
}

/**
 * One call to the local llama in strict-JSON mode (no native tool support on
 * this llama.cpp build). Returns the same shape as gatewayChat.
 */
export async function localChat({ llamaUrl, model = "preyas", messages, fetchImpl = fetch, timeoutMs = 90_000, maxTokens = 300 } = {}) {
  const url = String(llamaUrl || "http://127.0.0.1:8790").replace(/\/$/, "");
  const res = await fetchImpl(`${url}/v1/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model,
      stream: false,
      temperature: 0,
      max_tokens: maxTokens,
      chat_template_kwargs: { enable_thinking: false },
      messages,
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`local model answered ${res.status}`);
  const json = await res.json();
  const raw = String(json?.choices?.[0]?.message?.content || "").replace(/<think>[\s\S]*?<\/think>/gi, "");
  const usage = json && typeof json.usage === "object" ? json.usage : {};
  const parsed = parseLocalReply(raw);
  if (parsed.toolCalls) return { toolCalls: parsed.toolCalls, usage };
  if (parsed.answer) return { answer: parsed.answer, usage };
  throw new Error("local model answered in an unreadable way");
}

/** Parse the local model's strict-JSON reply: {"tool":..} or {"answer":..}. */
export function parseLocalReply(raw) {
  const text = String(raw ?? "").replace(/```(?:json)?/gi, "");
  const start = text.indexOf("{");
  if (start < 0) return {};
  const end = text.lastIndexOf("}");
  if (end <= start) return {};
  let parsed;
  try {
    parsed = JSON.parse(text.slice(start, end + 1));
  } catch {
    return {};
  }
  if (!parsed || typeof parsed !== "object") return {};
  if (typeof parsed.answer === "string" && parsed.answer.trim()) return { answer: parsed.answer.trim() };
  if (typeof parsed.tool === "string" && parsed.tool.trim()) {
    const args = parsed.args && typeof parsed.args === "object" ? parsed.args : {};
    return { toolCalls: [{ id: "", name: parsed.tool.trim(), args }] };
  }
  return {};
}

export function stripThinking(text) {
  return String(text ?? "")
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/<\/?think[^>]*>/gi, "")
    .trim();
}

/**
 * Keep the local fallback inside the 16K context: drop the oldest tool
 * exchanges until the transcript fits, always keeping system and user text.
 */
export function trimLocalLog(log, maxChars = MAX_LOCAL_CONTEXT_CHARS) {
  const out = [...log];
  let total = out.reduce((sum, entry) => sum + String(entry.text || "").length, 0);
  for (let index = 0; index < out.length && total > maxChars; index += 1) {
    const entry = out[index];
    if (entry.kind !== "toolresult" && entry.kind !== "toolcall") continue;
    total -= String(entry.text || "").length;
    out.splice(index, 1);
    index -= 1;
  }
  return out;
}

/**
 * The loop itself. Mutates `task` (steps, status, answer, model) and calls
 * deps.save() after every change so a restart can resume. deps:
 *   callModel(messages, { allowTools }) -> { answer? } | { toolCalls:[{name,args}] }
 *   review(action) -> { verdict: "allow"|"ask"|"block", why }
 *   execute(name, args) -> result string
 *   confirm(task, step, pending) -> "yes" | "no" | "expired"
 *   save(), maxSteps, activity (optional { begin, done, fail })
 *   brain (optional { emit }) — the hands neuron reports every model call and
 *   every tool run into it (thinking/done/error); without one, nothing emits.
 */
export async function runToolLoop(task, deps) {
  const {
    callModel,
    review,
    execute,
    confirm,
    confirmDetail = null,
    save = () => {},
    maxSteps = TOOL_LOOP_MAX_STEPS,
    activity = null,
    onLog = null,
    confirmTtlMs = 5 * 60_000,
    now = () => Date.now(),
    brain = null,
  } = deps;

  const log = [
    { kind: "system", text: TOOL_SYSTEM },
    { kind: "user", text: String(task.title || "") },
  ];

  // Replay finished tool steps so a resumed task continues with full context.
  for (const step of task.steps || []) {
    if (step.status !== "done" || !step.tool || !step.tool.name) continue;
    log.push({ kind: "toolcall", index: step.id, name: step.tool.name, args: step.tool.args || {} });
    log.push({ kind: "toolresult", index: step.id, name: step.tool.name, text: String(step.result || "") });
  }

  /** The hands neuron's feed; the loop never fails because of it. */
  const feed = (event) => {
    if (!brain || typeof brain.emit !== "function") return;
    try {
      brain.emit(event);
    } catch {
      /* the feed is a nicety */
    }
  };

  /** tokens/sec and paid cost for one finished model call. */
  const modelDoneStats = (response, startedAt) => {
    const usage = response && typeof response.usage === "object" ? response.usage : null;
    const end = now();
    const paid = usage && String(response.model) === "deepseek-flash";
    return {
      tps: usage ? tokensPerSec(usage, startedAt, end) : null,
      costUsd: paid ? paidCostUsd(usage, end) : null,
    };
  };

  const mark = (step, tool) => {
    if (!activity || !tool) return null;
    const begin =
      typeof activity.begin === "function"
        ? activity.begin(task.id, String(tool.name), labelForTool(tool.name, tool.args))
        : null;
    return {
      done: () => begin && begin.done(),
      fail: () => begin && begin.fail(),
    };
  };

  const runOne = async (step, name, args) => {
    const started = mark(step, { name, args });
    const label = labelForTool(name, args);
    feed({ neuron: "hands", state: "thinking", detail: label });
    try {
      const raw = await execute(name, args);
      const result = String(raw ?? "").slice(0, MAX_TOOL_RESULT_CHARS);
      if (started) started.done();
      feed({ neuron: "hands", state: "done", detail: label });
      return result;
    } catch (error) {
      if (started) started.fail();
      feed({ neuron: "hands", state: "error", detail: label });
      return `Tool error: ${error instanceof Error ? error.message : String(error)}`.slice(0, MAX_TOOL_RESULT_CHARS);
    }
  };

  const nextId = () => (task.steps ? task.steps.length : 0) + 1;
  let used = 0;

  // A stale confirm from before a restart (or one that was answered but never
  // ran): close it silently and move on; the tool is not executed again.
  for (const step of task.steps || []) {
    if (step.status !== "paused" || !step.pendingConfirm) continue;
    if (step.pendingConfirm.answered == null) step.pendingConfirm.answered = "expired";
    step.result =
      step.pendingConfirm.answered === "yes"
        ? "You said yes, but the step did not run before a restart, so I skipped it."
        : step.pendingConfirm.answered === "no"
          ? "You said no, so I skipped this step."
          : "No answer in time, so I skipped this step.";
    step.pendingConfirm = undefined;
    step.status = "done";
    if (step.tool && step.tool.name) {
      log.push({ kind: "toolcall", index: step.id, name: step.tool.name, args: step.tool.args || {} });
      log.push({ kind: "toolresult", index: step.id, name: step.tool.name, text: step.result });
    }
    task.updated = Date.now();
    save();
  }

  while (used < maxSteps) {
    const modelStartedAt = now();
    feed({ neuron: "hands", state: "thinking" });
    let response;
    try {
      response = await callModel(log, { allowTools: true });
    } catch (error) {
      feed({ neuron: "hands", state: "error", detail: error instanceof Error ? error.message : String(error) });
      throw error;
    }
    const modelStats = modelDoneStats(response, modelStartedAt);
    feed({
      neuron: "hands",
      state: "done",
      tps: modelStats.tps,
      costUsd: modelStats.costUsd,
      detail: response && response.model ? String(response.model) : null,
    });
    if (response.answer) {
      task.answer = String(response.answer).slice(0, 2000);
      task.status = "done";
      task.model = response.model || task.model;
      task.updated = Date.now();
      save();
      return task;
    }
    const call = Array.isArray(response.toolCalls) ? response.toolCalls[0] : null;
    if (!call || !call.name) {
      task.status = "error";
      task.updated = Date.now();
      save();
      return task;
    }
    task.model = response.model || task.model;
    const args = call.args && typeof call.args === "object" ? call.args : {};
    const action = {
      kind: String(call.name),
      args,
      userRequest: String(task.title || "").slice(0, 500),
      origin: "user",
      source: "task",
    };
    const verdict = await review(action);
    const step = {
      id: nextId(),
      text: labelForTool(call.name, args),
      status: "running",
      tool: { name: call.name, args },
    };
    task.steps = [...(task.steps || []), step];
    task.status = "running";
    task.updated = Date.now();
    save();
    onLog && onLog(`step ${step.id}: ${step.text} -> ${verdict.verdict}`);

    let result;
    if (verdict.verdict === "ask") {
      // The card's extra detail (file list for uploads) is a nicety: a
      // failing detail builder never blocks the confirmation.
      let detail = "";
      if (typeof confirmDetail === "function") {
        try {
          detail = String((await confirmDetail(call.name, args, task)) || "");
        } catch {
          detail = "";
        }
      }
      const pending = {
        token: randomToken(),
        why: String(verdict.why || "this needs your confirmation"),
        detail,
        action,
        expiresAt: now() + confirmTtlMs,
        answered: null,
      };
      step.pendingConfirm = pending;
      step.status = "paused";
      task.status = "paused";
      task.updated = Date.now();
      save();
      const decision = await confirm(task, step, pending);
      step.pendingConfirm.answered = decision;
      if (decision === "yes") {
        step.status = "running";
        step.pendingConfirm = undefined;
        task.status = "running";
        task.updated = Date.now();
        save();
        result = await runOne(step, call.name, args);
        step.status = "done";
      } else {
        step.pendingConfirm = undefined;
        step.result = decision === "no" ? "You said no, so I skipped this step." : "No answer in time, so I skipped this step.";
        step.status = "done";
      }
    } else if (verdict.verdict === "block") {
      result = `Blocked by the guard: ${verdict.why}`;
      step.status = "done";
    } else {
      result = await runOne(step, call.name, args);
      step.status = "done";
    }

    step.result = step.result || result || "(no result)";
    task.updated = Date.now();
    save();
    log.push({ kind: "toolcall", index: step.id, name: call.name, args });
    log.push({ kind: "toolresult", index: step.id, name: call.name, text: step.result });
    used += 1;
  }

  // All steps used: one final answer without tools.
  const finalLog = [{ kind: "system", text: FINAL_SYSTEM }, ...log.filter((entry) => entry.kind !== "system")];
  try {
    const finalStartedAt = now();
    feed({ neuron: "hands", state: "thinking" });
    const final = await callModel(finalLog, { allowTools: false });
    const finalStats = modelDoneStats(final, finalStartedAt);
    feed({
      neuron: "hands",
      state: "done",
      tps: finalStats.tps,
      costUsd: finalStats.costUsd,
      detail: final && final.model ? String(final.model) : null,
    });
    task.answer = String(final.answer || "I ran out of steps before I could finish this task.").slice(0, 2000);
  } catch (error) {
    feed({ neuron: "hands", state: "error", detail: error instanceof Error ? error.message : String(error) });
    task.answer = "I ran out of steps before I could finish this task.";
  }
  task.status = "done";
  task.updated = Date.now();
  save();
  return task;
}

export function randomToken(bytes = 9) {
  return [...crypto.getRandomValues(new Uint8Array(bytes))].map((b) => b.toString(16).padStart(2, "0")).join("");
}
