/**
 * Whether Preyas' voice comes out of the Mac's trackpad instead of its speakers
 * (Settings > Trackpad voice). The brain owns the switch — it is saved on the
 * drive, so the phone and the Mac agree — and this module only remembers the
 * answer for a few seconds, so one spoken reply asks the brain once.
 *
 * When it is on, the caller must not play the WAV as well: the trackpad is the
 * speaker, and playing both would cut each line off when the next sentence
 * arrives.
 */
import { brainFetch } from "../room/brain/token.ts";

export const TRACKPAD_CACHE_MS = 15_000;

let cache = { at: 0, on: false };

/**
 * The glass is on the Mac, so only the page running on the Mac may go quiet.
 * On the phone the WAV still plays: a trackpad in another room cannot talk to
 * the person holding the phone.
 */
function pageIsTheMac(): boolean {
  try {
    const host = typeof window !== "undefined" ? String(window.location?.hostname || "") : "";
    return host === "localhost" || host === "127.0.0.1" || host === "::1";
  } catch {
    return false;
  }
}

/** The answer from the last few seconds, without a request. */
export function trackpadCarriesVoice(now = Date.now()): boolean {
  return cache.on && now - cache.at < TRACKPAD_CACHE_MS;
}

/** Remember the switch the settings row just read or wrote. */
export function rememberTrackpadVoice(on: boolean, now = Date.now()): void {
  cache = { at: now, on: on === true };
}

/** Ask the brain, at most once every TRACKPAD_CACHE_MS. A dead brain means speakers. */
export async function refreshTrackpadVoice(brainUrl: string, now = Date.now()): Promise<boolean> {
  if (now - cache.at < TRACKPAD_CACHE_MS) return cache.on;
  try {
    const res = await brainFetch(`${brainUrl}/v1/trackpad`);
    const body = (await res.json()) as { available?: boolean; enabled?: boolean };
    rememberTrackpadVoice(pageIsTheMac() && Boolean(body && body.available && body.enabled !== false), now);
  } catch {
    rememberTrackpadVoice(false, now);
  }
  return cache.on;
}
