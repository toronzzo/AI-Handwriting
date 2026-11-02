/**
 * Task mode: a multi-step request becomes a plan that runs one step at a time
 * and is saved after every step, so a restart loses nothing.
 *
 * Pure logic only: the runner lives in the brain-server, the UI reads the same
 * shapes.
 */

export type TaskTool =
  | { name: "search_notes"; query: string }
  | { name: "list_files"; path: string }
  | { name: "read_file"; path: string };

export type TaskStepStatus = "pending" | "running" | "done" | "error";

export type TaskStep = {
  id: number;
  text: string;
  status: TaskStepStatus;
  result?: string;
  tool?: TaskTool | null;
};

export type TaskStatus = "planned" | "running" | "paused" | "done" | "error";

export type TaskRecord = {
  id: string;
  title: string;
  chatId: string;
  status: TaskStatus;
  steps: TaskStep[];
  created: number;
  updated: number;
};

export const TASK_MAX_STEPS = 6;

const TASK_STARTERS = [
  "plan", "summarize", "summarise", "review", "organize", "organise", "prepare",
  "compile", "outline", "compare", "audit", "research", "collect", "gather",
  "make a list", "make a plan", "build a plan", "put together",
];

/**
 * True for a request that needs several steps. Deliberately conservative: a
 * normal question that happens to contain "plan" stays a normal question.
 */
export function looksLikeTask(raw: string): boolean {
  const text = String(raw ?? "").trim().toLowerCase();
  if (!text) return false;
  if (/^task\s*[:\-]/.test(text)) return true;
  const starter = TASK_STARTERS.some(
    (word) => text === word || text.startsWith(`${word} `) || text.startsWith(`${word}:`),
  );
  if (!starter) return false;
  // A one-word "plan?" is a question about planning, not a request to plan.
  if (text.endsWith("?")) return false;
  if (text.length < 12) return false;
  // Chat questions often start with "summarize" or "explain step by step". Task
  // mode is only worth its extra model calls when notes/files or an explicit
  // multi-step request make several steps likely.
  const usesDriveWork = /\b(?:my\s+)?notes?\b|\bfiles?\b|\bfolders?\b|\bdirectory\b|\bdrive\b|\/volumes\/agent\b/.test(text);
  const explicitSteps = /\bstep by step\b|\bone step at a time\b|\binto steps\b|\band then\b/.test(text);
  return usesDriveWork || explicitSteps;
}

/** "Working on it: step 2 of 4…" and friends. */
export function taskStatusLine(task: TaskRecord): string {
  const total = task.steps.length;
  const index = task.steps.findIndex((step) => step.status === "running");
  const next = index >= 0 ? index : task.steps.findIndex((step) => step.status !== "done");
  const position = next >= 0 ? next + 1 : total;
  if (task.status === "done") return `Done: ${total} step${total === 1 ? "" : "s"}.`;
  if (task.status === "error") return `Stopped at step ${position} of ${total}.`;
  if (task.status === "paused") return `Paused at step ${position} of ${total}.`;
  if (task.status === "planned") return `Planning ${total} step${total === 1 ? "" : "s"}…`;
  return `Working on it: step ${position} of ${total}…`;
}

export function pendingSteps(task: TaskRecord): TaskStep[] {
  return task.steps.filter((step) => step.status === "pending" || step.status === "error");
}

/** The model's plan, tolerating thinking blocks and code fences. */
export function parsePlan(raw: string): { text: string; tool: TaskTool | null }[] {
  let text = String(raw ?? "");
  text = text.replace(/<think>[\s\S]*?<\/think>/gi, "");
  text = text.replace(/```(?:json)?/gi, "");
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start < 0 || end <= start) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.slice(start, end + 1));
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const out: { text: string; tool: TaskTool | null }[] = [];
  for (const item of parsed) {
    if (out.length >= TASK_MAX_STEPS) break;
    if (typeof item === "string") {
      const body = item.replace(/\s+/g, " ").trim();
      if (body) out.push({ text: body, tool: null });
      continue;
    }
    if (!item || typeof item !== "object") continue;
    const row = item as { text?: unknown; step?: unknown; tool?: unknown; name?: unknown };
    // Small models often answer with the tool call alone: {"name":"search_notes",...}
    const tool = parseTool(row.tool ?? (typeof row.name === "string" ? row : null));
    let body = String(row.text ?? row.step ?? "").replace(/\s+/g, " ").trim();
    if (!body && tool) body = toolLabel(tool);
    if (!body) continue;
    out.push({ text: body.slice(0, 160), tool });
  }
  return out;
}

/** A step name for a plan that named only a tool. */
export function toolLabel(tool: TaskTool): string {
  if (tool.name === "search_notes") return `Search my notes for "${tool.query}"`;
  if (tool.name === "list_files") return `List ${tool.path}`;
  return `Read ${tool.path}`;
}

export function parseTool(raw: unknown): TaskTool | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as { name?: unknown; query?: unknown; path?: unknown };
  const name = String(row.name ?? "");
  if (name === "search_notes") {
    const query = String(row.query ?? "").trim();
    return query ? { name, query: query.slice(0, 120) } : null;
  }
  if (name === "list_files" || name === "read_file") {
    const path = String(row.path ?? "").trim();
    return path ? { name, path: path.slice(0, 400) } : null;
  }
  return null;
}
