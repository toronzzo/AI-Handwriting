/**
 * Kiwix-only offline encyclopedia search. This module only talks to loopback
 * kiwix-serve; caller-facing URLs are proxy paths on the brain server.
 */
import http from "node:http";
import net from "node:net";

export const OFFLINE_KIWIX_URL = "http://127.0.0.1:8791";
export const OFFLINE_SEARCH_TIMEOUT_MS = 8000;
export const OFFLINE_IMAGE_MAX_BYTES = 8 * 1024 * 1024;
export const OFFLINE_ARTICLE_MAX_BYTES = 4 * 1024 * 1024;

function text(value) {
  return String(value ?? "").replace(/<[^>]*>/g, " ").replace(/&nbsp;/gi, " ").replace(/\s+/g, " ").trim();
}

function normalizeResult(raw) {
  if (!raw || typeof raw !== "object") return null;
  const title = text(raw.title || raw.name || "");
  const snippet = text(raw.snippet || raw.description || raw.text || "");
  const rawUrl = String(raw.url || raw.path || "");
  if (!title || !rawUrl) return null;
  const url = rawUrl.startsWith("/") ? rawUrl : `/${rawUrl}`;
  const imageUrl = raw.imageUrl || raw.image || raw.thumbnail || null;
  return {
    title,
    url,
    snippet,
    pack: String(raw.pack || raw.book || "").slice(0, 80),
    imageUrl: typeof imageUrl === "string" ? imageUrl : null,
  };
}

export function parseKiwixSearchJson(json, limit = 5) {
  const rows = Array.isArray(json)
    ? json
    : Array.isArray(json?.results)
      ? json.results
      : Array.isArray(json?.suggestions)
        ? json.suggestions
        : [];
  const out = [];
  const seen = new Set();
  for (const raw of rows) {
    const item = normalizeResult(raw);
    if (!item) continue;
    const key = `${item.title}\n${item.url}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
    if (out.length >= limit) break;
  }
  return out;
}

export async function searchOffline(query, options = {}) {
  const {
    baseUrl = process.env.PREYAS_KIWIX_URL || OFFLINE_KIWIX_URL,
    fetchImpl = fetch,
    timeoutMs = OFFLINE_SEARCH_TIMEOUT_MS,
    limit = 5,
  } = options;
  const clean = String(query ?? "").trim();
  if (!clean) return { ok: false, error: "empty query", results: [] };
  let url;
  try {
    url = new URL("/v1/search", baseUrl);
    url.searchParams.set("pattern", clean);
    url.searchParams.set("count", String(Math.min(20, Math.max(1, limit))));
  } catch {
    return { ok: false, error: "offline search is unavailable", results: [] };
  }
  try {
    const host = url.hostname.toLowerCase();
    if (!["127.0.0.1", "localhost"].includes(host)) {
      return { ok: false, error: "offline search is restricted to loopback", results: [] };
    }
    const res = await fetchImpl(url.href, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return { ok: false, error: `offline search answered ${res.status}`, results: [] };
    const json = await res.json();
    const results = parseKiwixSearchJson(json, limit).map((item) => ({
      ...item,
      url: `/v1/offline/article?path=${encodeURIComponent(item.url)}`,
      imageUrl: item.imageUrl
        ? `/v1/offline/image?path=${encodeURIComponent(item.imageUrl)}`
        : undefined,
      offline: true,
      sourceLabel: item.pack ? `Offline · ${item.pack}` : "Offline · Kiwix",
    }));
    return { ok: true, results };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "offline search unavailable",
      results: [],
    };
  }
}

/** True only for kiwix-serve itself: loopback host on the expected port. */
export function isLoopbackUrl(raw, allowedPort = 8791) {
  if (!String(raw || "").trim()) return false;
  try {
    const url = new URL(String(raw), OFFLINE_KIWIX_URL);
    if (!["127.0.0.1", "localhost"].includes(url.hostname)) return false;
    // No port means port 80, which is some other local server, not kiwix.
    return Number(url.port) === allowedPort;
  } catch {
    return false;
  }
}

/**
 * Fetch one Kiwix article through the brain server so kiwix-serve never faces
 * the LAN. The path must stay a root-relative path on the loopback server and
 * the body is capped so a huge page cannot exhaust memory.
 */
export async function proxyOfflineArticle(pathValue, options = {}) {
  const {
    baseUrl = process.env.PREYAS_KIWIX_URL || OFFLINE_KIWIX_URL,
    fetchImpl = fetch,
    timeoutMs = 8000,
    maxBytes = OFFLINE_ARTICLE_MAX_BYTES,
  } = options;
  const path = String(pathValue || "");
  if (!path.startsWith("/") || path.startsWith("//")) return { ok: false, status: 400 };
  let url;
  try {
    url = new URL(path, baseUrl);
  } catch {
    return { ok: false, status: 400 };
  }
  if (!isLoopbackUrl(url.href, Number(url.port || 8791))) return { ok: false, status: 400 };
  let res;
  try {
    res = await fetchImpl(url.href, {
      headers: { accept: "text/html,application/xhtml+xml" },
      signal: AbortSignal.timeout(timeoutMs),
      redirect: "error",
    });
  } catch {
    return { ok: false, status: 502 };
  }
  if (!res.ok) return { ok: false, status: res.status === 404 ? 404 : 502 };
  const buffer = Buffer.from(await res.arrayBuffer());
  if (buffer.byteLength > maxBytes) return { ok: false, status: 413 };
  const declared = String(res.headers?.get?.("content-type") || "").toLowerCase();
  const type = /^text\/html|^application\/xhtml\+xml/.test(declared) ? "text/html; charset=utf-8" : declared || "text/html; charset=utf-8";
  return { ok: true, status: 200, type, buffer };
}

export async function proxyOfflineImage(pathValue, options = {}) {
  const {
    baseUrl = process.env.PREYAS_KIWIX_URL || OFFLINE_KIWIX_URL,
    fetchImpl = fetch,
    timeoutMs = 8000,
    maxBytes = OFFLINE_IMAGE_MAX_BYTES,
  } = options;
  const path = String(pathValue || "");
  if (!path.startsWith("/")) return { ok: false, status: 400 };
  const url = new URL(path, baseUrl);
  if (!isLoopbackUrl(url.href, Number(url.port || 8791))) return { ok: false, status: 400 };
  if (!/^https?:/.test(url.protocol)) return { ok: false, status: 400 };
  const res = await fetchImpl(url.href, { headers: { accept: "image/*" }, signal: AbortSignal.timeout(timeoutMs), redirect: "error" });
  if (!res.ok) return { ok: false, status: res.status };
  const type = String(res.headers.get("content-type") || "").toLowerCase();
  if (!/^image\/(?:jpeg|png|gif|webp|avif)(?:;|$)/.test(type)) return { ok: false, status: 415 };
  const buffer = Buffer.from(await res.arrayBuffer());
  if (buffer.byteLength > maxBytes) return { ok: false, status: 413 };
  return { ok: true, status: 200, type, buffer };
}
