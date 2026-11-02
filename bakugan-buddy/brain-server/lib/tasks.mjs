/**
 * Task records on the Agent drive: memory/tasks/<id>.json, one file per task.
 * Every step result is written before the next step starts, so a restart can
 * always resume from the last finished step.
 */
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { TASK_MAX_STEPS } from "../../packages/alive/src/tasks.ts";

const ID_RE = /^[A-Za-z0-9_-]+$/;

export function tasksDir(root) {
  return path.join(root, "memory", "tasks");
}

export function taskPath(root, id) {
  if (!ID_RE.test(String(id))) throw new Error("bad task id");
  return path.join(tasksDir(root), `${id}.json`);
}

export function loadTask(root, id) {
  const file = taskPath(root, id);
  if (!fs.existsSync(file)) return null;
  try {
    const task = JSON.parse(fs.readFileSync(file, "utf8"));
    return normalizeTask(task);
  } catch {
    return null;
  }
}

export function saveTask(root, task) {
  fs.mkdirSync(tasksDir(root), { recursive: true });
  const body = JSON.stringify(task, null, 2) + "\n";
  const temp = `${taskPath(root, task.id)}.tmp`;
  fs.writeFileSync(temp, body);
  fs.renameSync(temp, taskPath(root, task.id));
  return task;
}

export function normalizeTask(raw) {
  const steps = Array.isArray(raw?.steps) ? raw.steps.slice(0, TASK_MAX_STEPS) : [];
  return {
    id: String(raw?.id || ""),
    title: String(raw?.title || ""),
    chatId: String(raw?.chatId || ""),
    status: ["planned", "running", "paused", "done", "error"].includes(raw?.status) ? raw.status : "planned",
    steps: steps.map((step, index) => ({
      id: Number(step?.id) || index + 1,
      text: String(step?.text || ""),
      status: ["pending", "running", "done", "error"].includes(step?.status) ? step.status : "pending",
      result: typeof step?.result === "string" ? step.result : undefined,
      tool: step?.tool && typeof step.tool === "object" ? step.tool : null,
    })),
    created: Number(raw?.created) || Date.now(),
    updated: Number(raw?.updated) || Date.now(),
  };
}

export function newTask(root, { title, chatId = "", steps }) {
  const now = Date.now();
  const task = normalizeTask({
    id: randomUUID(),
    title,
    chatId,
    status: "planned",
    steps: steps.map((step, index) => ({
      id: index + 1,
      text: step.text,
      status: "pending",
      tool: step.tool || null,
    })),
    created: now,
    updated: now,
  });
  saveTask(root, task);
  return task;
}

export function listTasks(root, { active = false } = {}) {
  const dir = tasksDir(root);
  if (!fs.existsSync(dir)) return [];
  const tasks = [];
  for (const name of fs.readdirSync(dir)) {
    if (!name.endsWith(".json")) continue;
    const task = loadTask(root, name.slice(0, -5));
    if (!task) continue;
    if (active && task.status === "done") continue;
    tasks.push(task);
  }
  tasks.sort((left, right) => right.updated - left.updated);
  return tasks;
}

/** A run interrupted by a restart is resumable, not stuck "running". */
export function pauseInterrupted(root) {
  let changed = 0;
  for (const task of listTasks(root)) {
    if (task.status !== "running" && task.status !== "planned") continue;
    for (const step of task.steps) {
      if (step.status === "running") step.status = "pending";
    }
    task.status = "paused";
    task.updated = Date.now();
    saveTask(root, task);
    changed += 1;
  }
  return changed;
}
