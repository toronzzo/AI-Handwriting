/**
 * Rough cost estimate for one Harness draft.
 *
 * Tokens are a proof of scale, not a tokenizer: one token is about four
 * characters, said plainly in `basis`. The prices come ONLY from the keys in
 * brain.env (`HARNESS_USD_PER_MTOK_IN` and `HARNESS_USD_PER_MTOK_OUT`); nothing
 * here hard-codes a DeepSeek price. A missing or non-positive price makes the
 * estimate `null` and the guard refuses the run (fail closed).
 */

/** What the user is told when no price is configured. */
export const PRICE_MISSING_MESSAGE =
  "Set HARNESS_USD_PER_MTOK_IN and _OUT in brain.env (check the DeepSeek price page)";

/** Default output allowance when HARNESS_OUT_TOKENS_MAX is unset. */
export const DEFAULT_OUT_TOKENS_MAX = 20000;

/** Characters per token, the whole of this estimate's accuracy. */
export const CHARS_PER_TOKEN = 4;

function positive(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

/** The output cap in tokens, from the env or the default. */
export function outTokensMaxOf(env = {}) {
  const configured = positive(env.HARNESS_OUT_TOKENS_MAX);
  return configured === null ? DEFAULT_OUT_TOKENS_MAX : Math.max(1, Math.floor(configured));
}

function round6(value) {
  return Math.round(value * 1_000_000) / 1_000_000;
}

/**
 * estimatePrompt(prompt, env) ->
 *   { inTokens, outTokensMax, usdLow, usdHigh, basis } | null
 *
 * `usdLow` uses 25% of the output allowance, `usdHigh` all of it. `null` means
 * "no price configured", never "free".
 */
export function estimatePrompt(prompt, env = {}) {
  const text = typeof prompt === "string" ? prompt : String(prompt ?? "");
  const inPrice = positive(env.HARNESS_USD_PER_MTOK_IN);
  const outPrice = positive(env.HARNESS_USD_PER_MTOK_OUT);
  if (inPrice === null || outPrice === null) return null;
  const outTokensMax = outTokensMaxOf(env);
  const inTokens = Math.ceil(text.length / CHARS_PER_TOKEN);
  const inCost = (inTokens * inPrice) / 1_000_000;
  const outLow = (outTokensMax * 0.25 * outPrice) / 1_000_000;
  const outHigh = (outTokensMax * outPrice) / 1_000_000;
  return {
    inTokens,
    outTokensMax,
    usdLow: round6(inCost + outLow),
    usdHigh: round6(inCost + outHigh),
    basis: "rough: chars / 4, 25%..100% of the output allowance",
  };
}

/** True when the env has everything the estimate needs. */
export function priceConfigured(env = {}) {
  return positive(env.HARNESS_USD_PER_MTOK_IN) !== null && positive(env.HARNESS_USD_PER_MTOK_OUT) !== null;
}

/**
 * usdForTokens(inTokens, outTokens, env) -> number | null.
 * The actual cost of a finished run when the CLI reported token usage; null
 * when no price is configured (the runner then records the estimate instead).
 */
export function usdForTokens(inTokens, outTokens, env = {}) {
  const inPrice = positive(env.HARNESS_USD_PER_MTOK_IN);
  const outPrice = positive(env.HARNESS_USD_PER_MTOK_OUT);
  if (inPrice === null || outPrice === null) return null;
  const input = Number(inTokens);
  const output = Number(outTokens);
  if (!Number.isFinite(input) || !Number.isFinite(output) || input < 0 || output < 0) return null;
  return round6((input * inPrice + output * outPrice) / 1_000_000);
}
