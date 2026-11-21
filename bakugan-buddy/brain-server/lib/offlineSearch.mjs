/**
 * Kiwix-only offline encyclopedia search. This module only talks to loopback
 * kiwix-serve; caller-facing URLs are proxy paths on the brain server.
 *
 * Real kiwix-serve (3.x) exposes public `/search?format=xml` and `/suggest`,
 * not a JSON `/v1/search` route. Search results are RSS/XML; pictures come
 * from the first inline image in each matching article.
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

function decodeXmlEntities(value) {
  return String(value ?? "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
}

async function readCappedBody(response, maxBytes) {
  if (!response.body) return Buffer.alloc(0);
  const reader = response.body.getReader();
  const chunks = [];
  let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (bytes + value.byteLength > maxBytes) {
        try {
          await reader.cancel();
        } catch {
          // The size limit still applies if the upstream cannot cancel cleanly.
        }
        return null;
      }
      chunks.push(Buffer.from(value));
      bytes += value.byteLength;
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, bytes);
}

function normalizeResult(raw) {
  if (!raw || typeof raw !== "object") return null;
  const title = text(raw.title || raw.name || raw.value || "");
  const snippet = text(raw.snippet || raw.description || raw.text || raw.label || "");
  const rawUrl = String(raw.url || raw.path || raw.link || "");
  if (!title || !rawUrl) return null;
  const url = rawUrl.startsWith("/") ? rawUrl : `/${rawUrl}`;
  const imageUrl = raw.imageUrl || raw.image || raw.img || raw.thumbnail || null;
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

/** Pull `<item>` rows out of a kiwix-serve `/search?format=xml` RSS payload. */
export function parseKiwixSearchXml(xml, limit = 5) {
  const out = [];
  const seen = new Set();
  const items = String(xml || "").match(/<item\b[\s\S]*?<\/item>/gi) || [];
  for (const block of items) {
    const title = decodeXmlEntities((block.match(/<title>([\s\S]*?)<\/title>/i) || [])[1] || "");
    const link = decodeXmlEntities((block.match(/<link>([\s\S]*?)<\/link>/i) || [])[1] || "");
    const description = decodeXmlEntities((block.match(/<description>([\s\S]*?)<\/description>/i) || [])[1] || "");
    if (!title || !link) continue;
    let pack = "";
    try {
      const parts = new URL(link, OFFLINE_KIWIX_URL).pathname.split("/").filter(Boolean);
      if (parts[0] === "content" && parts[1]) pack = parts[1];
    } catch {
      pack = "";
    }
    const item = normalizeResult({ title, url: link, description, pack });
    if (!item) continue;
    const key = `${item.title}\n${item.url}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
    if (out.length >= limit) break;
  }
  return out;
}

/** Book ids kiwix-serve accepts as `books.name` / `content=` values. */
export function parseKiwixBookNames(catalogXml) {
  const hrefs = String(catalogXml || "").match(/\/content\/[^"'<\s]+/g) || [];
  const names = [];
  const seen = new Set();
  for (const href of hrefs) {
    const name = href.replace(/^\/content\//, "").split("/")[0];
    if (!name || seen.has(name)) continue;
    seen.add(name);
    names.push(name);
  }
  return names;
}

function resolveArticleImage(articlePath, src) {
  const raw = String(src || "").trim();
  if (!raw || raw.startsWith("data:")) return null;
  try {
    const absolute = new URL(raw, `http://127.0.0.1:8791${articlePath}`);
    if (!["127.0.0.1", "localhost"].includes(absolute.hostname)) return null;
    if (!/\.(?:jpe?g|png|gif|webp|avif)(?:$|\?)/i.test(absolute.pathname)) return null;
    return absolute.pathname + absolute.search;
  } catch {
    return null;
  }
}

export function firstArticleImage(html, articlePath) {
  const match = String(html || "").match(/<img\b[^>]*\bsrc=["']([^"']+)["']/i);
  if (!match) return null;
  return resolveArticleImage(articlePath, match[1]);
}

async function listBooks(baseUrl, fetchImpl, timeoutMs) {
  const url = new URL("/catalog/v2/entries?count=-1", baseUrl);
  const res = await fetchImpl(url.href, {
    headers: { accept: "application/atom+xml,application/xml,text/xml,*/*" },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) return [];
  const xml = await res.text();
  return parseKiwixBookNames(xml);
}

async function enrichWithImages(results, options) {
  const { baseUrl, fetchImpl, timeoutMs } = options;
  const out = [];
  for (const item of results) {
    if (item.imageUrl) {
      out.push(item);
      continue;
    }
    try {
      const articleUrl = new URL(item.url, baseUrl);
      const res = await fetchImpl(articleUrl.href, {
        headers: { accept: "text/html,application/xhtml+xml" },
        signal: AbortSignal.timeout(Math.min(timeoutMs, 4000)),
        redirect: "follow",
      });
      if (!res.ok) {
        out.push(item);
        continue;
      }
      const html = await res.text();
      const imageUrl = firstArticleImage(html, articleUrl.pathname);
      out.push(imageUrl ? { ...item, imageUrl } : item);
    } catch {
      out.push(item);
    }
  }
  return out;
}

function toClientResults(rows) {
  return rows.map((item) => ({
    ...item,
    url: `/v1/offline/article?path=${encodeURIComponent(item.url)}`,
    imageUrl: item.imageUrl
      ? `/v1/offline/image?path=${encodeURIComponent(item.imageUrl)}`
      : undefined,
    offline: true,
    sourceLabel: item.pack ? `Offline · ${item.pack}` : "Offline · Kiwix",
  }));
}

export async function searchOffline(query, options = {}) {
  const {
    baseUrl = process.env.PREYAS_KIWIX_URL || OFFLINE_KIWIX_URL,
    fetchImpl = fetch,
    timeoutMs = OFFLINE_SEARCH_TIMEOUT_MS,
    limit = 5,
    enrichImages = true,
  } = options;
  const clean = String(query ?? "").trim();
  if (!clean) return { ok: false, error: "empty query", results: [] };
  let root;
  try {
    root = new URL(baseUrl);
  } catch {
    return { ok: false, error: "offline search is unavailable", results: [] };
  }
  const host = root.hostname.toLowerCase();
  if (!["127.0.0.1", "localhost"].includes(host)) {
    return { ok: false, error: "offline search is restricted to loopback", results: [] };
  }

  try {
    const books = await listBooks(root.href, fetchImpl, timeoutMs);
    if (!books.length) {
      return { ok: false, error: "no offline packs are loaded in kiwix-serve", results: [] };
    }

    const searchUrl = new URL("/search", root.href);
    searchUrl.searchParams.set("pattern", clean);
    searchUrl.searchParams.set("format", "xml");
    searchUrl.searchParams.set("pageLength", String(Math.min(20, Math.max(1, limit))));
    searchUrl.searchParams.set("start", "0");
    for (const book of books) searchUrl.searchParams.append("books.name", book);

    const res = await fetchImpl(searchUrl.href, {
      headers: { accept: "application/xml,text/xml,*/*" },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return { ok: false, error: `offline search answered ${res.status}`, results: [] };
    const xml = await res.text();
    let rows = parseKiwixSearchXml(xml, limit);
    if (!rows.length) {
      // Title suggestions are a useful fallback when full-text finds nothing.
      const suggestUrl = new URL("/suggest", root.href);
      suggestUrl.searchParams.set("content", books[0]);
      suggestUrl.searchParams.set("term", clean);
      suggestUrl.searchParams.set("count", String(Math.min(20, Math.max(1, limit))));
      const suggestRes = await fetchImpl(suggestUrl.href, {
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (suggestRes.ok) {
        const json = await suggestRes.json();
        rows = parseKiwixSearchJson(json, limit).map((item) => ({
          ...item,
          url: item.url.startsWith("/content/")
            ? item.url
            : `/content/${books[0]}/${item.url.replace(/^\//, "")}`,
          pack: item.pack || books[0],
        }));
      }
    }
    if (enrichImages && rows.length) {
      rows = await enrichWithImages(rows, { baseUrl: root.href, fetchImpl, timeoutMs });
    }
    return { ok: true, results: toClientResults(rows) };
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
  let buffer;
  try {
    buffer = await readCappedBody(res, maxBytes);
  } catch {
    return { ok: false, status: 502 };
  }
  if (!buffer) return { ok: false, status: 413 };
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
  let res;
  try {
    res = await fetchImpl(url.href, { headers: { accept: "image/*" }, signal: AbortSignal.timeout(timeoutMs), redirect: "error" });
  } catch {
    return { ok: false, status: 502 };
  }
  if (!res.ok) return { ok: false, status: res.status };
  const type = String(res.headers.get("content-type") || "").toLowerCase();
  if (!/^image\/(?:jpeg|png|gif|webp|avif)(?:;|$)/.test(type)) return { ok: false, status: 415 };
  let buffer;
  try {
    buffer = await readCappedBody(res, maxBytes);
  } catch {
    return { ok: false, status: 502 };
  }
  if (!buffer) return { ok: false, status: 413 };
  return { ok: true, status: 200, type, buffer };
}
