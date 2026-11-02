/**
 * Remember the pairing token and attach it to every brain request.
 *
 * The brain lives on the same host as the page, so one small wrapper here beats
 * touching thirty call sites — and a phone that is already paired never has to
 * think about it again.
 */
const KEY = "bakugan-buddy.pair.token";

export function readToken(): string {
  try {
    return (typeof localStorage !== "undefined" && localStorage.getItem(KEY)) || "";
  } catch {
    return "";
  }
}

export function writeToken(token: string): void {
  try {
    if (token) localStorage.setItem(KEY, token);
    else localStorage.removeItem(KEY);
  } catch {
    /* private browsing still works, just unpaired */
  }
}

export function clearToken(): void {
  writeToken("");
}

/** True when the brain answered "pair me first". */
export function isUnauthorized(status: number): boolean {
  return status === 401 || status === 429;
}

/**
 * A fetch that carries the pairing token. Anything else (icons, Expo assets,
 * the model gateway) is passed through untouched.
 */
export function brainFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const token = readToken();
  if (!token) return fetch(input, init);
  const raw = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
  if (!/\/v1\//.test(raw)) return fetch(input, init);
  const headers = new Headers(init?.headers || (input instanceof Request ? input.headers : undefined));
  headers.set("X-Preyas-Token", token);
  return fetch(input, { ...init, headers });
}

/**
 * Pair with the code shown on the Mac. Returns true once the token is stored.
 * In development the page itself can pair; the token is what lasts.
 */
export async function pairWithCode(
  brainUrl: string,
  code: string,
  name: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetchImpl(`${brainUrl}/v1/pair`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code, name }),
    });
    const body = (await res.json()) as { ok?: boolean; token?: string; error?: string };
    if (!res.ok || !body.ok || !body.token) {
      return { ok: false, error: body.error || "pairing failed" };
    }
    writeToken(body.token);
    return { ok: true };
  } catch {
    return { ok: false, error: "the Mac did not answer" };
  }
}
