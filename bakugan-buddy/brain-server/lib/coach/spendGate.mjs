/**
 * Spend gate (the seed of the later Сторож guard): read-only view of what the
 * paid route cost today and the user's daily cap.
 *
 * Three spend files are summed against the SAME cap, so there is only one
 * daily limit for all paid work: every paid model call in `spend/paid.jsonl`
 * (paid chat and paid computer proposals, each written once by the brain), the
 * Harness runs in `spend/harness.jsonl` and tool tasks in
 * `spend/tasks.jsonl`.
 *
 * Paid chat used to be read from the costUsd the app put on a chat row. That
 * made the app the judge of its own limit, and a client that under-reported
 * spent past the cap. The brain now writes the paid chat line itself, from the
 * usage the gateway returned (appendPaidSpend); the costUsd on a stored
 * row stays only for the "~$0.0012" label and is the one number the cap never
 * reads.
 */
import fs from "node:fs";
import path from "node:path";
import { estimatePaidCostUsd } from "../../../packages/alive/src/confirm.ts";

export const DEFAULT_CAP_USD = 1.0;

/** Reason code when the Agent drive is missing: nothing can be counted, so nothing is sent. */
export const NO_LEDGER_REASON = "no_ledger";

function dayKeyOf(ms) {
  const d = new Date(ms);
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${month}-${day}`;
}

/** Sum one money field in a JSONL file for the local day; a missing/bad file counts 0. */
function sumMoneyFile(file, day, field) {
  let text = "";
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    return 0; // missing file counts as nothing, never throws
  }
  let total = 0;
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try {
      const entry = JSON.parse(line);
      if (entry && typeof entry === "object" && dayKeyOf(Number(entry.t) || 0) !== day) continue;
      const cost = Number(entry && entry[field]);
      if (Number.isFinite(cost) && cost > 0) total += cost;
    } catch {
      /* bad line counts 0 */
    }
  }
  return total;
}

/** Sum of paid chat, Harness and tool-task cost for the local calendar day. */
export function spentTodayUsd(dataDir, now = new Date()) {
  if (!dataDir) return 0;
  const day = dayKeyOf(now instanceof Date ? now.getTime() : Number(now));
  const paid = sumMoneyFile(path.join(dataDir, "spend", "paid.jsonl"), day, "usd");
  const harness = sumMoneyFile(path.join(dataDir, "spend", "harness.jsonl"), day, "usd");
  const tasks = sumMoneyFile(path.join(dataDir, "spend", "tasks.jsonl"), day, "usd");
  return paid + harness + tasks;
}

/** Append one spend line to <dataDir>/spend/<file> as {t, usd, src?}; a bad number writes nothing. */
function appendSpendLine(dataDir, file, usd, now = new Date(), src = "") {
  const value = Number(usd);
  if (!dataDir || !Number.isFinite(value) || value <= 0) return;
  const dir = path.join(dataDir, "spend");
  fs.mkdirSync(dir, { recursive: true });
  const line = { t: (now instanceof Date ? now.getTime() : Number(now)) || Date.now(), usd: value };
  if (src) line.src = String(src).slice(0, 24);
  fs.appendFileSync(path.join(dir, file), `${JSON.stringify(line)}\n`);
}

/** Append one tool-task spend line: <dataDir>/spend/tasks.jsonl {t, usd}. */
export function appendTaskSpend(dataDir, usd, now = new Date()) {
  appendSpendLine(dataDir, "tasks.jsonl", usd, now);
}

/**
 * Append what one paid model call really cost: <dataDir>/spend/paid.jsonl.
 * Only the brain calls this, with the usage the gateway reported back, so the
 * cap counts the money that was actually spent rather than the app's guess.
 * One line per finished call — the paid chat pipe and the paid computer
 * proposal each settle exactly once — and `src` says which one it was.
 */
export function appendPaidSpend(dataDir, usd, src = "chat", now = new Date()) {
  appendSpendLine(dataDir, "paid.jsonl", usd, now, src);
}

/** The daily cap from the spend setting; missing/invalid -> DEFAULT_CAP_USD. */
export function capUsd(dataDir) {
  if (!dataDir) return DEFAULT_CAP_USD;
  try {
    const parsed = JSON.parse(fs.readFileSync(path.join(dataDir, "settings", "spend.json"), "utf8"));
    const value = Number(parsed && parsed.dailyCapUsd);
    return Number.isFinite(value) && value > 0 ? value : DEFAULT_CAP_USD;
  } catch {
    return DEFAULT_CAP_USD;
  }
}

/**
 * Costs of work still running, keyed by owner ("task:<id>", "harness:<id>").
 * A running task registers its accrued gateway cost (and the harness its
 * worst-case estimate), so parallel or long runs count against the one daily
 * cap BEFORE their spend line is written to disk.
 */
const inFlight = new Map();

export function setInFlightCost(key, usd) {
  const value = Number(usd);
  if (!Number.isFinite(value) || value <= 0) inFlight.delete(String(key));
  else inFlight.set(String(key), value);
  return inFlightCostUsd();
}

/** The summed in-flight cost of everything still running. */
export function inFlightCostUsd() {
  let total = 0;
  for (const value of inFlight.values()) {
    if (Number.isFinite(value) && value > 0) total += value;
  }
  return total;
}

/** spent + in-flight + estimate must stay under the cap. Read-only.
 * The in-flight ledger total is included by DEFAULT, so every existing call
 * site counts work that is still running; callers may pass an explicit value
 * (tests) but cannot accidentally skip it. */
export function allowPaid(dataDir, estimateUsd, now = new Date(), inFlightUsd = inFlightCostUsd()) {
  const spent = spentTodayUsd(dataDir, now);
  const cap = capUsd(dataDir);
  const estimate = Number(estimateUsd) || 0;
  const running = Math.max(0, Number(inFlightUsd) || 0);
  if (spent + running + estimate > cap) {
    return { allowed: false, reason: "over_cap", spentTodayUsd: spent, inFlightUsd: running, capUsd: cap };
  }
  return { allowed: true, reason: "ok", spentTodayUsd: spent, inFlightUsd: running, capUsd: cap };
}

/**
 * What one paid chat turn may cost at most: the request text as prompt tokens
 * plus the documented 2048-token output ceiling. The request body arrives as
 * bytes, so callers pass the byte length — a few percent above the real prompt
 * length, which errs towards refusing rather than overshooting.
 */
export const PAID_CHAT_MAX_TOKENS = 2048;

export function paidChatEstimateUsd(promptChars) {
  return estimatePaidCostUsd(Number(promptChars) || 0, PAID_CHAT_MAX_TOKENS);
}

/**
 * The one gate every paid chat turn passes before a byte leaves this Mac.
 * Same cap, same settings file, same in-flight ledger as the Harness, task and
 * Coach paths; only the estimate source differs (a request body, not a prompt
 * the brain built). Read-only: it refuses, it never writes.
 */
export function paidChatGate(dataDir, promptChars, now = new Date()) {
  const estimateUsd = paidChatEstimateUsd(promptChars);
  const gate = allowPaid(dataDir, estimateUsd, now);
  return { ...gate, estimateUsd };
}

/**
 * The status a client shows before it offers a paid route: would one small paid
 * ask fit right now, and if not, why. Read-only — it reserves nothing, so it
 * never blocks itself.
 */
export function paidRoomStatus(dataDir, now = new Date()) {
  if (!dataDir) return { allowed: false, spentTodayUsd: 0, capUsd: DEFAULT_CAP_USD, estimateUsd: 0, reason: NO_LEDGER_REASON };
  const gate = paidChatGate(dataDir, 0, now);
  return {
    allowed: gate.allowed,
    spentTodayUsd: gate.spentTodayUsd,
    capUsd: gate.capUsd,
    estimateUsd: gate.estimateUsd,
    reason: gate.allowed ? "ok" : gate.reason,
  };
}

/** Reservation keys for in-flight paid chats; one per request, released by the caller. */
let paidChatReservations = 0;

/**
 * Reserve the worst case of one paid chat turn BEFORE it is sent, so two
 * requests cannot both spend the same remaining headroom (the task runner does
 * the same with its $0.002 gateway allowance). Refused requests reserve
 * nothing. `release()` is idempotent and safe to call on every exit path — a
 * failure, a timeout or a client that walked away still frees the room.
 */
export function beginPaidChat(dataDir, promptChars, now = new Date()) {
  // No drive, no ledger, no cap: a paid turn is refused rather than sent into
  // untracked spending.
  if (!dataDir) {
    return {
      ok: false,
      gate: { allowed: false, reason: NO_LEDGER_REASON, spentTodayUsd: 0, capUsd: DEFAULT_CAP_USD, estimateUsd: 0 },
      release: () => {},
    };
  }
  const gate = paidChatGate(dataDir, promptChars, now);
  if (!gate.allowed) return { ok: false, gate, release: () => {} };
  paidChatReservations += 1;
  const key = `paid-chat:${paidChatReservations}`;
  setInFlightCost(key, gate.estimateUsd);
  let held = true;
  return {
    ok: true,
    gate,
    release: () => {
      if (!held) return;
      held = false;
      setInFlightCost(key, 0);
    },
  };
}
