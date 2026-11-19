/**
 * The daily spend limit, stored on the drive — never in secrets/.env.
 *
 * The file is `<dataDir>/settings/spend.json` and its shape is exactly
 * `{ dailyCapUsd, updatedAt }`, which is what `capUsd()` in
 * `coach/spendGate.mjs` already reads. There is no second cap and no second
 * key. `writeSpendSetting` is the only writer and only `proxy.mjs` may import
 * it: no model-callable path can change the limit.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  DEFAULT_CAP_USD,
  spentTodayUsd,
} from "../coach/spendGate.mjs";

export { DEFAULT_CAP_USD };

/** The one place the setting lives, relative to the data root. */
export const SPEND_SETTING_PATH = "settings/spend.json";

/** Bounds the app and the route both enforce. */
export const CAP_MIN_USD = 0.1;
export const CAP_MAX_USD = 20;

/** The word the route requires before it saves anything. */
export const SAVE_CONFIRM = "save";

const fail = (error) => ({ ok: false, error });

/**
 * validateCap(x) -> { ok: true, value } | { ok: false, error }
 * Accepts a number or a numeric string (a comma works as the decimal
 * separator), rounds to 2 decimals, and rejects NaN, negatives and anything
 * that is not a number.
 */
export function validateCap(value) {
  if (value === null || value === undefined || typeof value === "boolean") {
    return fail("Enter a daily limit in USD.");
  }
  let number;
  if (typeof value === "number") {
    number = value;
  } else if (typeof value === "string") {
    const text = value.trim().replace(",", ".");
    if (!text) return fail("Enter a daily limit in USD.");
    if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(text)) return fail("Use numbers only, like 1.00.");
    number = Number(text);
  } else {
    return fail("Use a number like 1.00.");
  }
  if (!Number.isFinite(number)) return fail("Use a number like 1.00.");
  const rounded = Math.round(number * 100) / 100;
  if (rounded < CAP_MIN_USD) return fail(`The smallest daily limit is $${CAP_MIN_USD.toFixed(2)}.`);
  if (rounded > CAP_MAX_USD) return fail(`The largest daily limit is $${CAP_MAX_USD.toFixed(2)}.`);
  return { ok: true, value: rounded };
}

/**
 * readSpendSetting(dataDir) -> { dailyCapUsd, spentTodayUsd, updatedAt }.
 * Missing or corrupt files give the default $1.00 and never throw.
 */
export function readSpendSetting(dataDir) {
  const fallback = { dailyCapUsd: DEFAULT_CAP_USD, spentTodayUsd: spentTodayUsd(dataDir), updatedAt: null };
  if (!dataDir) return fallback;
  try {
    const parsed = JSON.parse(fs.readFileSync(path.join(dataDir, SPEND_SETTING_PATH), "utf8"));
    const value = Number(parsed && parsed.dailyCapUsd);
    const updatedAt = Number(parsed && parsed.updatedAt);
    return {
      dailyCapUsd: Number.isFinite(value) && value > 0 ? value : DEFAULT_CAP_USD,
      spentTodayUsd: spentTodayUsd(dataDir),
      updatedAt: Number.isFinite(updatedAt) && updatedAt > 0 ? updatedAt : null,
    };
  } catch {
    return fallback;
  }
}

/**
 * writeSpendSetting(dataDir, usd) -> { ok, dailyCapUsd, updatedAt } | { ok: false, error }.
 * Writes `{ dailyCapUsd, updatedAt }` atomically (temp file + rename). Only
 * proxy.mjs may call this.
 */
export function writeSpendSetting(dataDir, usd, now = Date.now()) {
  const checked = validateCap(usd);
  if (!checked.ok) return checked;
  if (!dataDir) return fail("The drive is not connected.");
  const file = path.join(dataDir, SPEND_SETTING_PATH);
  const temp = `${file}.${process.pid}.${crypto.randomBytes(4).toString("hex")}.tmp`;
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(temp, JSON.stringify({ dailyCapUsd: checked.value, updatedAt: Number(now) }));
    fs.renameSync(temp, file);
    return { ok: true, dailyCapUsd: checked.value, updatedAt: Number(now) };
  } catch (error) {
    try {
      fs.unlinkSync(temp);
    } catch {
      /* the temp file may never have been created */
    }
    return fail(error instanceof Error ? error.message : "could not save the limit");
  }
}

/**
 * checkSpendSaveRequest(body) -> { ok: true, value } | { ok: false, error }.
 * The POST route's decisions, pure, so the test does not need a server: the
 * confirm word must be exactly "save" and the amount must pass validateCap.
 */
export function checkSpendSaveRequest(body = {}) {
  if (!body || typeof body !== "object") return fail("bad request");
  if (String(body.confirm ?? "") !== SAVE_CONFIRM) {
    return fail('The limit changes only with a tap on Save (confirm: "save").');
  }
  return validateCap(body.dailyCapUsd);
}
