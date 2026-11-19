/**
 * Money helpers for the Daily limit row and the Harness card. Pure: no React,
 * no network, no colours — the tests import this file directly under node.
 *
 * Bounds match the brain's spend setting: $0.10 to $20.00, two decimals, a
 * comma may be used as the decimal separator.
 */

export const CAP_MIN_USD = 0.1;
export const CAP_MAX_USD = 20;
export const CAP_DEFAULT_USD = 1;

/** What the Harness card says when no price is configured on the Mac. */
export const PRICE_SETUP_HINT =
  "Set HARNESS_USD_PER_MTOK_IN and _OUT in brain.env (check the DeepSeek price page)";

export type UsdCheck = { ok: true; value: number } | { ok: false; error: string };

/** "0,5" -> 0.5; "", "abc", "1.2.3" -> null. */
export function parseUsd(text: string): number | null {
  const flat = String(text ?? "").trim().replace(",", ".");
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(flat)) return null;
  const value = Number(flat);
  return Number.isFinite(value) ? value : null;
}

/** Same bounds as the brain, rounded to two decimals. */
export function validateUsd(value: number): UsdCheck {
  const number = Number(value);
  if (!Number.isFinite(number)) return { ok: false, error: "Use a number like 1.00." };
  const rounded = Math.round(number * 100) / 100;
  if (rounded < CAP_MIN_USD) return { ok: false, error: `The smallest limit is ${formatUsd(CAP_MIN_USD)}.` };
  if (rounded > CAP_MAX_USD) return { ok: false, error: `The largest limit is ${formatUsd(CAP_MAX_USD)}.` };
  return { ok: true, value: rounded };
}

/** 0.5 -> "$0.50". Never throws on a bad number. */
export function formatUsd(value: number): string {
  const number = Number(value);
  const safe = Number.isFinite(number) ? Math.max(0, number) : 0;
  return `$${safe.toFixed(2)}`;
}

export type HarnessEstimateLike = { usdLow?: number; usdHigh?: number } | null | undefined;

/** "About $0.01 to $0.02. Rough estimate." or the setup message. */
export function formatEstimate(estimate: HarnessEstimateLike): string {
  const low = Number(estimate?.usdLow);
  const high = Number(estimate?.usdHigh);
  if (!Number.isFinite(low) || !Number.isFinite(high)) return PRICE_SETUP_HINT;
  return `About ${formatUsd(low)} to ${formatUsd(high)}. Rough estimate.`;
}

/** "Today: $0.50 of $1.00", shared by the Settings row and the Harness card. */
export function todayLine(spent: number, cap: number): string {
  return `Today: ${formatUsd(spent)} of ${formatUsd(cap)}`;
}

/** How full the thin bar is: 0..1, never negative and never past the end. */
export function spendRatio(spent: number, cap: number): number {
  const used = Number(spent);
  const limit = Number(cap);
  if (!Number.isFinite(used) || !Number.isFinite(limit) || limit <= 0) return 0;
  return Math.min(1, Math.max(0, used / limit));
}
