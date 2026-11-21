/**
 * Honest Settings messages. A slow Mac, a missing pairing token, an HTTP error
 * and a broken network are four different things to a person, so the probes
 * must never call them all "timed out". Pure: no React, no network.
 */

export const PAIR_HINT = "Pair this device with the code shown on the Mac.";

/** The `error` line a brain response carries, if it has one. */
export function errorDetail(body: unknown): string {
  if (!body || typeof body !== "object") return "";
  const detail = (body as { error?: unknown }).error;
  return typeof detail === "string" ? detail.trim().slice(0, 120) : "";
}

/**
 * Why a request that DID reach the Mac was refused. 401/429 mean the device is
 * not paired (or is being throttled), which is not a timeout and not a crash.
 */
export function probeResponseError(subject: string, status: number, body: unknown): string {
  if (status === 401 || status === 429) return PAIR_HINT;
  const detail = errorDetail(body);
  if (detail) return `${subject} answered ${status}: ${detail}`;
  return `${subject} answered ${status}.`;
}

/** Why the request never got a usable answer. Only a real abort is a timeout. */
export function probeThrownError(subject: string, error: unknown): string {
  const name =
    error && typeof error === "object" && "name" in error ? String((error as { name?: string }).name) : "";
  if (name === "TimeoutError" || name === "AbortError") return `${subject} timed out. Is Preyas running?`;
  const message = error instanceof Error ? error.message : "";
  // A cross-origin failure and a closed port both land here as a bare TypeError.
  if (/failed to fetch|networkerror|load failed/i.test(message)) {
    return `${subject} could not reach the Mac. Is Preyas running?`;
  }
  return message ? `${subject} failed: ${message.slice(0, 120)}` : `${subject} could not reach the Mac. Is Preyas running?`;
}

/** The Mac answered with something that is not JSON (a proxy error page, say). */
export function probeBodyError(subject: string, status: number): string {
  return `${subject} answered ${status} but the answer was not JSON.`;
}
