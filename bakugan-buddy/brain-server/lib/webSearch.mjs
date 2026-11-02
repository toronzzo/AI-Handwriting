/**
 * Free web search through DuckDuckGo's HTML endpoint: no key, no paid API.
 * Results are cached for an hour on the drive, and at most one search runs
 * every two seconds so the endpoint is never hammered.
 */
import fs from "node:fs";
import path from "node:path";
import {
  htmlToText,
  isFetchableUrl,
  parseDuckDuckGoHtml,
  searchQueryFrom,
} from "../../packages/alive/src/webSearch.ts";

export const SEARCH_ENDPOINT = "https://html.duckduckgo.com/html/";
export const CACHE_TTL_MS = 60 * 60 * 1000;
export const MIN_GAP_MS = 2000;
export const FETCH_TIMEOUT_MS = 8000;
export const PAGE_MAX_CHARS = 6000;

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

export function cacheDir(root) {
  return path.join(root, "cache", "search");
}

function cacheKey(query) {
  return query.toLowerCase().replace(/[^a-z0-9\u0400-\u04ff]+/g, "-").replace(/^-|-$/g, "").slice(0, 80);
}

function cachePath(root, query) {
  const key = cacheKey(query) || "empty";
  return path.join(cacheDir(root), `${key}.json`);
}

export function readCache(root, query, now = Date.now()) {
  try {
    const file = cachePath(root, query);
    if (!fs.existsSync(file)) return null;
    const body = JSON.parse(fs.readFileSync(file, "utf8"));
    if (!body || !Array.isArray(body.results)) return null;
    if (typeof body.at !== "number" || now - body.at > CACHE_TTL_MS) return null;
    return body.results;
  } catch {
    return null;
  }
}

export function writeCache(root, query, results, now = Date.now()) {
  try {
    fs.mkdirSync(cacheDir(root), { recursive: true });
    fs.writeFileSync(cachePath(root, query), JSON.stringify({ at: now, query, results }));
  } catch {
    /* a cache miss next time is not an error */
  }
}

let lastSearchAt = 0;
let gate = Promise.resolve();

/** Serialise searches so two requests can never be closer than MIN_GAP_MS. */
async function rateLimited(task) {
  const run = gate.then(async () => {
    const wait = Math.max(0, MIN_GAP_MS - (Date.now() - lastSearchAt));
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    lastSearchAt = Date.now();
    return task();
  });
  gate = run.catch(() => {});
  return run;
}

export async function searchWeb(query, options = {}) {
  const {
    root,
    useCache = true,
    now = Date.now(),
    fetchImpl = fetch,
    timeoutMs = FETCH_TIMEOUT_MS,
    limit = 5,
  } = options;
  const clean = searchQueryFrom(query);
  if (!clean) return { ok: false, error: "empty query", results: [], cached: false };

  if (root && useCache) {
    const hit = readCache(root, clean, now);
    if (hit) return { ok: true, results: hit, cached: true };
  }

  try {
    const results = await rateLimited(async () => {
      const res = await fetchImpl(`${SEARCH_ENDPOINT}?q=${encodeURIComponent(clean)}`, {
        headers: {
          "User-Agent": UA,
          Accept: "text/html,application/xhtml+xml",
          "Accept-Language": "en-US,en;q=0.9",
        },
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) throw new Error(`search answered ${res.status}`);
      const html = await res.text();
      return parseDuckDuckGoHtml(html, limit);
    });
    if (root && results.length) writeCache(root, clean, results, now);
    return { ok: true, results, cached: false };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      results: [],
      cached: false,
    };
  }
}

/** Fetch one result page as plain text. http/https only, never this machine. */
export async function fetchPageText(url, options = {}) {
  const { fetchImpl = fetch, timeoutMs = FETCH_TIMEOUT_MS, cap = PAGE_MAX_CHARS } = options;
  if (!isFetchableUrl(url)) return { ok: false, error: "url is not a public http(s) page", text: "" };
  try {
    const res = await fetchImpl(url, {
      headers: { "User-Agent": UA, Accept: "text/html,text/plain;q=0.9" },
      signal: AbortSignal.timeout(timeoutMs),
      redirect: "follow",
    });
    if (!res.ok) throw new Error(`page answered ${res.status}`);
    const type = String(res.headers?.get?.("content-type") || "");
    if (type && !/text\/html|text\/plain|application\/xhtml/i.test(type)) {
      return { ok: false, error: `not a text page (${type})`, text: "" };
    }
    const body = await res.text();
    return { ok: true, text: htmlToText(body, cap) };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error), text: "" };
  }
}
