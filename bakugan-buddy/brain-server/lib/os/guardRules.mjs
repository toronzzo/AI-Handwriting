/**
 * Сторож rule engine: pure, deterministic checks for one tool action.
 * Every rule has an id and a plain-English `why`. The rules decide first;
 * the local model is only a tie-breaker for "unsure" and can only tighten.
 */
import { resolveSafePath, SAFE_ROOT } from "../safeFs.mjs";

export const KINDS = {
  read: new Set(["read_file", "list_files", "search_notes", "search_vault"]),
  write: new Set(["write_vault", "add_note", "add_reminder"]),
  destructive: new Set(["delete_note", "delete_reminder", "delete_file", "overwrite_file"]),
  paid: new Set(["paid_call", "run_harness"]),
  control: new Set(["computer_click", "computer_keys", "computer_open_app"]),
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

function pathArgs(action) {
  if (!action || typeof action.args !== "object" || action.args === null) return [];
  return ["path", "file", "target"].map((key) => action.args[key]).filter((value) => typeof value === "string");
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

  // R2: file paths resolve under the safe root; secret names are off limits.
  for (const target of pathArgs(action)) {
    try {
      resolveSafePath(target, deps.fsRoot || SAFE_ROOT);
    } catch (error) {
      findings.push({ id: "R2", verdict: "block", why: `path is outside the safe root (${error instanceof Error ? error.message : String(error)})` });
    }
    if (SECRET_SEGMENT.test(target)) {
      findings.push({ id: "R2", verdict: "block", why: "secrets are off limits" });
    }
  }

  // R7: argument sanity (checked early so it can override a friendlier rule).
  for (const [name, value] of Object.entries(args)) {
    if (typeof value !== "string") continue;
    if (value.length > MAX_STRING_ARG) {
      findings.push({ id: "R7", verdict: "block", why: `argument "${name}" is longer than ${MAX_STRING_ARG} characters` });
    }
    if (CONTROL_CHARS.test(value)) {
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
  if (origin === "content" && ["write", "destructive", "paid", "control"].includes(cls)) {
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
