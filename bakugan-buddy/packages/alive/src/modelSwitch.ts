/**
 * The local model switch: three sizes of Qwen3 behind one llama-server.
 * Pure rules only — the server lifecycle lives in the brain-server.
 *
 * - "use small" / "use big" / "use huge" are chat commands.
 * - Big needs a Yes/No heads-up when the Mac has under 10 GB free.
 * - Huge always needs the heads-up (it will swap no matter what).
 */

export type LocalModelId = "small" | "big" | "huge";

export const LOCAL_MODEL_IDS: readonly LocalModelId[] = ["small", "big", "huge"];

/** Short labels shown in chat and on the Status switcher. */
export const MODEL_LABELS: Record<LocalModelId, string> = {
  small: "Small · Qwen3 8B",
  big: "Big · Qwen3 14B",
  huge: "Huge · Qwen3 30B-A3B",
};

/** Under this much free memory, the 14B model asks before loading. */
export const BIG_MIN_FREE_GB = 10;

/**
 * "use small", "use big", "use huge" — with a trailing word or two ignored,
 * so "use big please" still works.
 */
export function parseModelCommand(text: string): LocalModelId | null {
  const match = String(text)
    .trim()
    .toLowerCase()
    .match(/^use\s+(small|big|huge)\b/);
  return match ? (match[1] as LocalModelId) : null;
}

/**
 * Does switching to this model need a Yes/No card first?
 * Big: only when the Mac has under 10 GB free (or we could not measure it).
 * Huge: always — 14.7 GB of weights on a 16 GB Mac swaps no matter what.
 */
export function switchNeedsConfirm(target: LocalModelId, freeGb: number | null): boolean {
  if (target === "huge") return true;
  if (target === "big") {
    return !(typeof freeGb === "number" && Number.isFinite(freeGb) && freeGb >= BIG_MIN_FREE_GB);
  }
  return false;
}
