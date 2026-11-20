/**
 * Сторож rule engine: pure, deterministic checks for one tool action.
 * Every rule has an id and a plain-English `why`. The rules decide first;
 * the local model is only a tie-breaker for "unsure" and can only tighten.
 */
import { resolveSafePath, SAFE_ROOT } from "../safeFs.mjs";
import { SHELL_SECRET } from "./terminalServer.mjs";

export const KINDS = {
  read: new Set([
    "read_file",
    "list_files",
    "search_notes",
    "search_vault",
    "files_read_text_file",
    "files_read_multiple_files",
    "files_list_directory",
    "files_directory_tree",
    "files_search_files",
    "files_get_file_info",
    "files_list_allowed_directories",
    "browser_navigate",
    "browser_navigate_back",
    "browser_snapshot",
    "browser_console_messages",
    "browser_network_requests",
    "browser_tabs",
    "browser_wait_for",
    "browser_take_screenshot",
  ]),
  write: new Set(["write_vault", "add_note", "add_reminder"]),
  /** File writes and moves: always a Yes/No confirm (R9), never auto-allowed. */
  filewrite: new Set(["files_write_file", "files_edit_file", "files_create_directory", "files_move_file"]),
  destructive: new Set(["delete_note", "delete_reminder", "delete_file", "overwrite_file"]),
  paid: new Set(["paid_call", "run_harness"]),
  control: new Set([
    "computer_click",
    "computer_keys",
    "computer_open_app",
    "shell_run",
    "browser_click",
    "browser_type",
    "browser_fill_form",
    "browser_select_option",
    "browser_hover",
    "browser_drag",
    "browser_press_key",
    "browser_file_upload",
    "browser_handle_dialog",
    "browser_evaluate",
  ]),
};

export function kindClass(kind) {
  for (const [name, set] of Object.entries(KINDS)) {
    if (set.has(kind)) return name;
  }
  return "unknown";
}

export const DESTRUCTIVE_INTENT =
  /(?:^|[^a-zа-яё0-9])(delete|remove|erase|overwrite|удали|удалить|сотри|стереть|убери|убрать|перезапиши|перезаписать)(?=$|[^a-zа-яё0-9])/iu;

export const WRITE_INTENT = {
  vault:
    /(?:^|[^a-zа-яё0-9])(save|remember|note|сохрани|сохранить|запомни|запомнить|запиши|записать)(?=$|[^a-zа-яё0-9])/iu,
  reminder: /(?:^|[^a-zа-яё0-9])(remind|reminder|напомни|напомнить|напоминание)(?=$|[^a-zа-яё0-9])/iu,
};

export const SECRET_SEGMENT = /(^|\/)(secrets|\.env(\..*)?|.*\.pem|.*\.key|id_rsa.*|.*token.*)($|\/)/i;
export const PATH_SEGMENT_DOTS = /(^|\/)\.\.(\/|$)/;
/** A URL with a scheme (anything but http/https) is refused; "note: x" is not a URL. */
export const URL_SCHEME = /^[a-z][a-z0-9+.-]*:\/\//i;
export const MAX_STRING_ARG = 4000;
// eslint-disable-next-line no-control-regex
export const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;
// eslint-disable-next-line no-control-regex
/** File content may contain newlines and tabs; other control characters stay blocked. */
export const FILE_CONTENT_CONTROLS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;

/** Path-like arguments that must resolve under the safe roots. */
const PATH_ARG_KEYS = ["path", "file", "target", "source", "destination", "cwd"];

function pathArgs(action) {
  if (!action || typeof action.args !== "object" || action.args === null) return [];
  const out = [];
  for (const key of PATH_ARG_KEYS) {
    const value = action.args[key];
    if (typeof value === "string") out.push(value);
    else if (Array.isArray(value)) for (const entry of value) if (typeof entry === "string") out.push(entry);
  }
  return out;
}

/** True when a path resolves inside the Agent drive or the repo folder. */
export function pathIsSafe(target, deps = {}) {
  for (const root of [deps.fsRoot || SAFE_ROOT, ...(deps.repoRoot ? [deps.repoRoot] : [])]) {
    try {
      resolveSafePath(target, root);
      return true;
    } catch {
      /* try the next root */
    }
  }
  return false;
}

/**
 * One rule check: { id, verdict: "allow" | "ask" | "block" | "unsure", why }.
 * The worst verdict wins: block > ask > unsure > allow.
 */
export function reviewRules(action, deps = {}) {
  const findings = [];
  const kind = String(action?.kind || "");
  const cls = kindClass(kind);
  const userRequest = String(action?.userRequest || "");
  const origin = String(action?.origin || "user");
  const args = action && typeof action.args === "object" && action.args !== null ? action.args : {};

  // R1: unknown kind -> block.
  if (cls === "unknown") {
    findings.push({ id: "R1", verdict: "block", why: `unknown tool kind "${kind || "(none)"}"` });
  }

  // R2: file paths resolve under the safe roots; secret names are off limits.
  for (const target of pathArgs(action)) {
    if (!pathIsSafe(target, deps)) {
      findings.push({ id: "R2", verdict: "block", why: "path is outside the safe roots (/Volumes/Agent and the repo folder)" });
    }
    if (SECRET_SEGMENT.test(target)) {
      findings.push({ id: "R2", verdict: "block", why: "secrets are off limits" });
    }
  }
  // R2-shell: a shell command must not touch secret paths either.
  if (kind === "shell_run") {
    const command = String(args.command || "");
    if (SHELL_SECRET.test(command)) {
      findings.push({ id: "R2", verdict: "block", why: "secrets are off limits" });
    }
  }

  // R7: argument sanity (checked early so it can override a friendlier rule).
  for (const [name, value] of Object.entries(args)) {
    if (typeof value !== "string") continue;
    if (value.length > MAX_STRING_ARG) {
      findings.push({ id: "R7", verdict: "block", why: `argument "${name}" is longer than ${MAX_STRING_ARG} characters` });
    }
    // File content is the one place newlines are legitimate; other control
    // characters stay blocked everywhere.
    const isFileContent = (kind === "files_write_file" || kind === "files_edit_file") && name === "content";
    if ((isFileContent ? FILE_CONTENT_CONTROLS : CONTROL_CHARS).test(value)) {
      findings.push({ id: "R7", verdict: "block", why: `argument "${name}" contains control characters` });
    }
    if (PATH_SEGMENT_DOTS.test(value)) {
      findings.push({ id: "R7", verdict: "block", why: `argument "${name}" contains a ".." path segment` });
    }
    if (URL_SCHEME.test(value) && !/^https?:\/\//i.test(value)) {
      findings.push({ id: "R7", verdict: "block", why: `argument "${name}" uses a non-http(s) URL scheme` });
    }
  }

  // R5: an instruction found inside content cannot write, destroy, spend or
  // control. Checked before R3/R4/R6 so this is the rule that is reported.
  if (origin === "content" && ["write", "filewrite", "destructive", "paid", "control"].includes(cls)) {
    findings.push({ id: "R5", verdict: "block", why: "an instruction found inside content, not from you" });
  }

  // R3: destructive kinds need the user's own destructive intent; never allow.
  if (cls === "destructive") {
    if (!DESTRUCTIVE_INTENT.test(userRequest)) {
      findings.push({ id: "R3", verdict: "block", why: "this deletes or overwrites, and you did not ask for that" });
    } else {
      findings.push({ id: "R3", verdict: "ask", why: "deleting or overwriting needs your confirmation" });
    }
  }

  // R4: paid kinds go through the spend gate; unknown price blocks.
  if (cls === "paid") {
    const estimateUsd = Number(args.estimateUsd);
    if (!Number.isFinite(estimateUsd) || estimateUsd < 0) {
      findings.push({ id: "R4", verdict: "block", why: "daily limit: the price is unknown" });
    } else if (!deps.allowPaid) {
      findings.push({ id: "R4", verdict: "ask", why: "this spends money and needs your confirmation" });
    } else {
      const gate = deps.allowPaid(deps.dataDir, estimateUsd, typeof deps.now === "function" ? deps.now() : new Date());
      if (!gate.allowed) {
        findings.push({ id: "R4", verdict: "block", why: "daily limit reached for today" });
      } else {
        findings.push({ id: "R4", verdict: "ask", why: `this spends about $${estimateUsd.toFixed(2)} and needs your confirmation` });
      }
    }
  }

  // R6: write kinds need a fitting intent word; otherwise unsure (model decides).
  if (cls === "write") {
    if (kind === "add_reminder") {
      if (!WRITE_INTENT.reminder.test(userRequest)) {
        findings.push({ id: "R6", verdict: "unsure", why: "you asked to write something, but not clearly a reminder" });
      }
    } else if (!WRITE_INTENT.vault.test(userRequest)) {
      findings.push({ id: "R6", verdict: "unsure", why: "you asked to write something, but not clearly to save or remember it" });
    }
  }

  // R9: file writes, edits and moves always need a Yes/No card, never auto-allow.
  if (cls === "filewrite") {
    findings.push({ id: "R9", verdict: "ask", why: "writing or changing files needs your confirmation" });
  }

  // R10: shell commands always need a Yes/No card (checked before R8 so its
  // plain-English reason is the one reported).
  if (kind === "shell_run") {
    findings.push({ id: "R10", verdict: "ask", why: "running a shell command needs your confirmation" });
  }

  // R8: control kinds are always ask (a later slice's deny list may block first).
  if (cls === "control") {
    findings.push({ id: "R8", verdict: "ask", why: "controlling your computer always needs your OK" });
  }

  // Read kinds that passed R1, R2 and R7 are allowed.
  if (cls === "read" && !findings.some((finding) => finding.verdict === "block" || finding.verdict === "ask" || finding.verdict === "unsure")) {
    findings.push({ id: "R1-R7", verdict: "allow", why: "reading is safe" });
  }

  if (cls === "write" && !findings.some((finding) => finding.verdict === "block" || finding.verdict === "ask" || finding.verdict === "unsure")) {
    findings.push({ id: "R6", verdict: "allow", why: "the request fits this write" });
  }

  return findings;
}

const RANK = { block: 3, ask: 2, unsure: 1, allow: 0 };

/** The worst finding wins; ties keep the first (most specific) rule. */
export function decide(findings) {
  let best = { id: "", verdict: "allow", why: "" };
  for (const finding of findings) {
    if (RANK[finding.verdict] > RANK[best.verdict]) best = finding;
  }
  return best;
}
