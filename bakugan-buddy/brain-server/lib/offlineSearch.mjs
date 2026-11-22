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

/** Words that describe the request, not the article. "planet" stays: it picks a sense. */
const FILLER_WORDS = new Set(
  "a an the about me tell please with picture pictures photo photos image images show of for and or to in on from my your you i can could would what is are was were who how do does did explain describe give want know like just some this that there here offline library article wiki wikipedia".split(
    " ",
  ),
);

/** Generic senses. The title lookup uses the specific word ("saturn"), not "planet". */
const GENERIC_TITLE_WORDS = new Set("planet planets star stars moon moons galaxy galaxies".split(" "));

const SPACE_QUERY =
  /\b(planet|planets|moon|moons|star|stars|galaxy|galaxies|orbit|orbits|astronomy|astronomical|solar|saturn|jupiter|mars|venus|mercury|neptune|uranus|pluto|comet|comets|asteroid|asteroids|nebula|supernova|eclipse|constellation|telescope|milky|universe|cosmos|black hole)\b/i;

const REPAIR_QUERY = /\b(ifixit|repair|replace|replacement|battery|screen|teardown|disassembl\w*|iphone|macbook|laptop)\b/i;

/**
 * Turn a chat sentence into the words Kiwix should actually search.
 * "tell me about Saturn the planet, with a picture" becomes "saturn planet".
 */
export function cleanOfflineQuery(raw) {
  const original = String(raw ?? "").replace(/\s+/g, " ").trim();
  if (!original) return { original: "", terms: [], pattern: "" };
  const terms = original
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/[\s-]+/)
    .filter((word) => word && !FILLER_WORDS.has(word) && word.length > 1);
  const pattern = terms.length ? terms.join(" ") : original;
  const kept = terms.length ? terms : original.toLowerCase().split(/\s+/).filter(Boolean);
  return { original, terms: kept, pattern };
}

export function titleTermFrom(terms) {
  const list = Array.isArray(terms) ? terms : [];
  const specific = list.find((term) => term && !GENERIC_TITLE_WORDS.has(term));
  return specific || list[0] || "";
}

export function isSpaceQuery(text) {
  return SPACE_QUERY.test(String(text || ""));
}

function bookRank(name, space, repair) {
  const label = String(name || "");
  let score = 0;
  if (space && /astronom/i.test(label)) score += 100;
  if (repair && /ifixit/i.test(label)) score += 100;
  if (space && /ifixit/i.test(label)) score -= 10;
  if (repair && /astronom/i.test(label)) score -= 10;
  return score;
}

/** Astronomy packs first for space questions, iFixit first for repairs. */
export function orderOfflineBooks(books, query) {
  const text = String(query || "");
  const space = isSpaceQuery(text);
  const repair = REPAIR_QUERY.test(text);
  return [...(books || [])].sort((left, right) => bookRank(right, space, repair) - bookRank(left, space, repair));
}

function bareTitle(title) {
  return String(title || "")
    .toLowerCase()
    .replace(/\s*\([^)]*\)\s*/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isDisambiguation(hit) {
  const title = String(hit?.title || "");
  const snippet = String(hit?.snippet || "");
  return /\bdisambiguation\b/i.test(title) || /may refer to/i.test(snippet);
}

function scoreOfflineHit(hit, terms, space) {
  const title = String(hit?.title || "").toLowerCase();
  const bare = bareTitle(hit?.title);
  const joined = terms.join(" ");
  const head = terms[0] || "";
  let score = 0;
  if (joined && (title === joined || bare === joined || title === head || bare === head)) score += 120;
  else if (terms.length && terms.every((term) => title.includes(term))) score += 70;
  else if (terms.some((term) => title.includes(term))) score += 25;
  else score -= 40;
  if (head && title.startsWith(`${head} `) && title !== head && bare !== head) score -= 15;
  if (isDisambiguation(hit)) score -= 90;
  if (space && /astronom/i.test(hit?.pack || "")) score += 30;
  if (space && /ifixit/i.test(hit?.pack || "")) score -= 20;
  return score;
}

/** Exact or parenthetical title ("Saturn", "Saturn (planet)"), never a disambiguation page. */
export function exactOfflineTitle(hit, terms) {
  const title = String(hit?.title || "").toLowerCase();
  const bare = bareTitle(hit?.title);
  const list = Array.isArray(terms) ? terms.map((term) => String(term || "").toLowerCase()).filter(Boolean) : [];
  const head = titleTermFrom(list);
  const joined = list.join(" ");
  if (!head || isDisambiguation(hit)) return false;
  return title === head || bare === head || title === joined || bare === joined;
}

/** Higher scores first. Original order breaks ties so a stable kiwix list stays stable. */
export function rankOfflineHits(hits, terms, options = {}) {
  const wanted = (Array.isArray(terms) ? terms : []).map((term) => String(term || "").toLowerCase()).filter(Boolean);
  const space = Boolean(options.space);
  return [...(hits || [])]
    .map((hit, index) => ({ hit, index, score: scoreOfflineHit(hit, wanted, space) }))
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .map((row) => row.hit);
}

/**
 * kiwix-serve `/suggest` is an OpenSearch suggestion list:
 * [query, titles, descriptions, urls]. Older JSON `{ suggestions }` still works.
 */
export function parseKiwixSuggest(json, book, limit = 5) {
  if (Array.isArray(json) && Array.isArray(json[1])) {
    const titles = json[1];
    const descriptions = Array.isArray(json[2]) ? json[2] : [];
    const urls = Array.isArray(json[3]) ? json[3] : [];
    const out = [];
    const seen = new Set();
    for (let index = 0; index < titles.length && out.length < limit; index += 1) {
      const title = text(titles[index]);
      if (!title) continue;
      const rawUrl = String(urls[index] || "");
      const url = rawUrl.startsWith("/") ? rawUrl : `/content/${book}/${title.replace(/\s+/g, "_")}`;
      const item = normalizeResult({ title, url, description: descriptions[index] || "", pack: book });
      if (!item) continue;
      const key = `${item.title}\n${item.url}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(item);
    }
    return out;
  }
  return parseKiwixSearchJson(json, limit).map((item) => ({
    ...item,
    pack: item.pack || book,
    url: item.url.startsWith("/content/") ? item.url : `/content/${book}/${item.url.replace(/^\//, "")}`,
  }));
}

function dedupeHits(rows) {
  const out = [];
  const seen = new Set();
  for (const item of rows) {
    if (!item) continue;
    const key = `${item.title}\n${item.url}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

function searchUrlFor(root, book, pattern, pageLength) {
  const searchUrl = new URL("/search", root);
  searchUrl.searchParams.set("pattern", pattern);
  searchUrl.searchParams.set("format", "xml");
  searchUrl.searchParams.set("pageLength", String(pageLength));
  searchUrl.searchParams.set("start", "0");
  if (book) searchUrl.searchParams.append("books.name", book);
  return searchUrl;
}

async function fetchSearchXml(fetchImpl, url, timeoutMs) {
  return fetchImpl(url, {
    headers: { accept: "application/xml,text/xml,*/*" },
    signal: AbortSignal.timeout(timeoutMs),
  });
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

  const cleaned = cleanOfflineQuery(clean);
  if (!cleaned.pattern) return { ok: false, error: "empty query", results: [] };
  const space = isSpaceQuery(cleaned.original);
  const head = titleTermFrom(cleaned.terms);

  try {
    const listed = await listBooks(root.href, fetchImpl, timeoutMs);
    if (!listed.length) {
      return { ok: false, error: "no offline packs are loaded in kiwix-serve", results: [] };
    }
    const books = orderOfflineBooks(listed, cleaned.original);
    const preferred = books[0];
    const pageLength = Math.min(20, Math.max(8, limit * 3));

    const primary = await fetchSearchXml(
      fetchImpl,
      searchUrlFor(root.href, preferred, cleaned.pattern, pageLength).href,
      timeoutMs,
    );
    if (!primary.ok) return { ok: false, error: `offline search answered ${primary.status}`, results: [] };
    let rows = parseKiwixSearchXml(await primary.text(), pageLength).map((item) => ({
      ...item,
      pack: item.pack || preferred,
    }));

    // Full-text alone ranks "Saturn" as a car company or a film award. A title
    // lookup on the pack that matches the question, then a rerank, fixes that.
    const titled = rankOfflineHits(rows, cleaned.terms, { space }).some((hit) => exactOfflineTitle(hit, cleaned.terms));
    if (!titled) {
      const extra = [];
      if (head) {
        try {
          const suggestUrl = new URL("/suggest", root.href);
          suggestUrl.searchParams.set("content", preferred);
          suggestUrl.searchParams.set("term", head);
          suggestUrl.searchParams.set("count", String(pageLength));
          const suggestRes = await fetchImpl(suggestUrl.href, {
            headers: { accept: "application/json,application/x-suggestions+json,*/*" },
            signal: AbortSignal.timeout(timeoutMs),
          });
          if (suggestRes.ok) extra.push(...parseKiwixSuggest(await suggestRes.json(), preferred, pageLength));
        } catch {
          /* title suggestions are optional */
        }
        try {
          const titleRes = await fetchSearchXml(
            fetchImpl,
            searchUrlFor(root.href, preferred, `title:${head}`, pageLength).href,
            timeoutMs,
          );
          if (titleRes.ok) {
            extra.push(
              ...parseKiwixSearchXml(await titleRes.text(), pageLength).map((item) => ({
                ...item,
                pack: item.pack || preferred,
              })),
            );
          }
        } catch {
          /* a title-field search is optional */
        }
      }
      for (const book of books.slice(1, 3)) {
        try {
          const res = await fetchSearchXml(
            fetchImpl,
            searchUrlFor(root.href, book, cleaned.pattern, pageLength).href,
            timeoutMs,
          );
          if (!res.ok) continue;
          extra.push(
            ...parseKiwixSearchXml(await res.text(), pageLength).map((item) => ({
              ...item,
              pack: item.pack || book,
            })),
          );
        } catch {
          /* another pack is optional once one pack answered */
        }
      }
      rows = dedupeHits([...rows, ...extra]);
    }

    let ranked = rankOfflineHits(rows, cleaned.terms, { space });
    const withTitle = ranked.filter((hit) => {
      const title = String(hit.title || "").toLowerCase();
      return cleaned.terms.some((term) => title.includes(term));
    });
    if (withTitle.length) ranked = withTitle;
    ranked = ranked.slice(0, limit);
    if (enrichImages && ranked.length) {
      ranked = await enrichWithImages(ranked, { baseUrl: root.href, fetchImpl, timeoutMs });
    }
    return { ok: true, results: toClientResults(ranked) };
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
