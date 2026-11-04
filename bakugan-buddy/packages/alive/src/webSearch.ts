/**
 * Web search, without a key and without a paid API.
 *
 * The parsing and the trigger rules are pure so they can be tested without a
 * network: the brain-server does the fetching, the app uses the same rules to
 * decide when to ask.
 */

export type SearchResult = {
  title: string;
  url: string;
  snippet: string;
};

const PRIVATE_V4: readonly RegExp[] = [
  /^10\./,
  /^127\./,
  /^169\.254\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^192\.168\./,
  /^0\./,
];

/** True for loopback, RFC1918, link-local, CGNAT and other non-public hosts. */
export function isPrivateHost(hostname: string): boolean {
  const host = String(hostname || "").toLowerCase().replace(/^\[|\]$/g, "");
  if (!host) return true;
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) return true;
  if (host === "::1" || host === "::" || host.startsWith("fe80:") || host.startsWith("fc") || host.startsWith("fd")) {
    return true;
  }
  if (host.startsWith("::ffff:")) return isPrivateHost(host.slice(7));
  const v4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!v4) return false;
  const octets = v4.slice(1).map((part) => Number(part));
  if (octets.some((part) => part > 255)) return true;
  if (octets[0] === 100 && octets[1] >= 64 && octets[1] <= 127) return true; // CGNAT
  return PRIVATE_V4.some((pattern) => pattern.test(host));
}

/** Only http/https, and never something that points back at this machine. */
export function isFetchableUrl(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(String(raw ?? "").trim());
  } catch {
    return false;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return false;
  return !isPrivateHost(url.hostname);
}

/**
 * DuckDuckGo wraps results as /l/?uddg=<encoded target>. Return the target, or
 * the original string when it is already a plain link.
 */
export function unwrapDuckDuckGoUrl(raw: string): string {
  const text = String(raw ?? "").trim().replace(/&amp;/g, "&");
  if (!text) return "";
  let url: URL;
  try {
    url = new URL(text, "https://duckduckgo.com");
  } catch {
    return text;
  }
  const wrapped = url.searchParams.get("uddg");
  if (wrapped) {
    try {
      return decodeURIComponent(wrapped);
    } catch {
      return wrapped;
    }
  }
  if (url.hostname === "duckduckgo.com" && url.pathname.startsWith("/l/")) {
    const direct = url.searchParams.get("u");
    if (direct) return direct;
  }
  return text;
}

function decodeEntities(text: string): string {
  return String(text ?? "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#x27;|&#39;/gi, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Parse the DuckDuckGo HTML result page. Links are unwrapped and private
 * targets dropped, duplicates removed, and at most `limit` results returned.
 */
export function parseDuckDuckGoHtml(html: string, limit = 5): SearchResult[] {
  const text = String(html ?? "");
  const results: SearchResult[] = [];
  const seen = new Set<string>();
  const blockRe = /<div[^>]+class="[^"]*\bresult\b[^"]*"[^>]*>([\s\S]*?)(?=<div[^>]+class="[^"]*\bresult\b|<div[^>]+class="[^"]*nav-link|<\/body>|$)/gi;
  for (const match of text.matchAll(blockRe)) {
    const block = match[1] || "";
    const link = block.match(/<a[^>]+class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
    if (!link) continue;
    const url = unwrapDuckDuckGoUrl(link[1] || "");
    if (!url || seen.has(url) || !isFetchableUrl(url)) continue;
    const title = decodeEntities(link[2] || "");
    const snippetMatch = block.match(/<a[^>]+class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>/i);
    const snippet = snippetMatch ? decodeEntities(snippetMatch[1] || "") : "";
    seen.add(url);
    results.push({ title: title || url, url, snippet });
    if (results.length >= limit) break;
  }
  return results;
}

// An explicit request to look something up, not the word "search" appearing
// anywhere (a pasted PR report can mention "web search" without wanting one).
const SEARCH_INTENT =
  /^\s*(?:please\s+)?(?:search|google|look\s?up)\b|\b(?:search\s+for|search\s+what|google\s+(?:for|it|this)|look\s?up|look\s+it\s+up)\b/i;

const FRESH_HINTS = [
  /\blatest\b/i,
  /\bnews\b/i,
  /\btoday\b/i,
  /\bweather\b/i,
  /\bprice\b/i,
  /\bwho is\b/i,
  /\bhow much (is|does|are)\b/i,
  /\bcurrent\b.*\b(price|score|rate|version|weather)\b/i,
];

// Questions about our own world are answered from memory, not the web.
const LOCAL_TOPICS =
  /\b(chat|our talk|conversation|my notes?|reminders?|documents?|study|decks?|cards|vault|what did i say|you said|you told me)\b/i;

// Short conversational replies never need the web.
const FOLLOW_UP =
  /^(yes|yeah|yep|no|nope|ok(?:ay)?|sure|why|how|what|huh|really|go on|continue|tell me more|and\??|thanks?|thank you|lol|haha|nice|cool|wow|hm+|mhm)[.!?\s]*$/i;

// Feelings, advice and chat about us are never a web question.
const SMALL_TALK = /\bhow are you\b|\bfeel(?:ing|ings)?\b|\badvice\b|\bwhat do you think about (me|us)\b/i;

/**
 * Should this message trigger a web search? Pure and small so it is easy to
 * tune. Saying "search"/"look up" always searches. A long pasted block that
 * is being explained, questions about our chat/notes/documents/vault, and
 * small talk or short follow-ups never do. Fresh-fact hints (latest, news,
 * today, weather, price…) do.
 */
export function shouldWebSearch(raw: string): boolean {
  const text = String(raw ?? "").trim();
  if (!text) return false;
  if (/^\/search\b/i.test(text)) return true;
  if (SEARCH_INTENT.test(text)) return true;
  if (FOLLOW_UP.test(text)) return false;
  if (SMALL_TALK.test(text)) return false;
  const lines = text.split("\n").filter((line) => line.trim()).length;
  const longPastedBlock = text.length > 400 || lines > 2;
  if (longPastedBlock) return false;
  if (LOCAL_TOPICS.test(text)) return false;
  return FRESH_HINTS.some((pattern) => pattern.test(text));
}

/** Backwards-compatible name; the full trigger rules live in shouldWebSearch. */
export function needsWebSearch(raw: string): boolean {
  return shouldWebSearch(raw);
}

/**
 * Keep only the sources the reply actually cites as [n], each with its
 * original number so the label matches the citation. An answer built only on
 * the user's pasted text cites nothing, so nothing is shown.
 */
export function citedSourceEntries(
  reply: string,
  sources: readonly SearchResult[],
): { n: number; source: SearchResult }[] {
  const text = String(reply ?? "");
  const out: { n: number; source: SearchResult }[] = [];
  const seen = new Set<number>();
  for (const match of text.matchAll(/\[(\d+)\]/g)) {
    const n = Number(match[1]);
    const source = sources[n - 1];
    if (!source || seen.has(n)) continue;
    seen.add(n);
    out.push({ n, source });
  }
  return out;
}

/** The query to send, with a leading /search stripped. */
export function searchQueryFrom(raw: string): string {
  return String(raw ?? "")
    .trim()
    .replace(/^\/search\s*/i, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200);
}

/** The numbered source block that goes into the prompt. */
export function sourcesPrompt(query: string, results: readonly SearchResult[]): string {
  const rows = results
    .map((result, index) => `[${index + 1}] ${result.title}\n${result.url}\n${result.snippet}`)
    .join("\n\n");
  return [
    "Web results for your partner's message. Use them, and cite the number of the source you used like [1] or [2].",
    "Answer in at most three sentences. If the results do not answer it, say so.",
    `Search: ${query}`,
    rows,
  ].join("\n");
}

/** Build the user turn: the sources first, then what they actually asked. */
export function withSources(userText: string, query: string, results: readonly SearchResult[]): string {
  if (!results.length) return userText;
  return `${sourcesPrompt(query, results)}\n\nThey said: ${userText}`;
}

/** Plain text of an HTML page, capped so it fits a small context. */
export function htmlToText(html: string, cap = 6000): string {
  const text = String(html ?? "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<[^>]+>/g, " ");
  const clean = decodeEntities(text);
  return clean.length > cap ? `${clean.slice(0, cap).trimEnd()}…` : clean;
}
