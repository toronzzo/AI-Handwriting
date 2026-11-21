/**
 * Presentation rules for offline Kiwix sources in chat.
 *
 * Kept as plain functions so the mapping from a brain-server result to what
 * the chat bubble shows (inline image, enlarge target, article link, source
 * tag) is unit-testable without a renderer.
 */

export type OfflineSourceLike = {
  title: string;
  url: string;
  snippet?: string;
  imageUrl?: string;
  offline?: boolean;
  sourceLabel?: string;
  pack?: string;
};

/** The short tag shown in front of an offline title, e.g. "offline · Wikipedia". */
export function offlineSourceTag(source: OfflineSourceLike): string {
  const label = String(source.sourceLabel || source.pack || "").trim();
  const name = label
    .replace(/^offline\s*[·:|-]\s*/i, "")
    .replace(/^(wikipedia|ifixit)\w*_/i, "$1 ")
    .replace(/[_-]+/g, " ")
    .trim();
  if (!name) return "offline";
  if (/wikipedia/i.test(name)) return "offline · Wikipedia";
  if (/ifixit/i.test(name)) return "offline · iFixit";
  return `offline · ${name.slice(0, 24)}`;
}

/**
 * The absolute URL for an image or article, with the device token added as a
 * query parameter because an <img> tag or a new tab cannot send our header.
 * Returns "" for anything that is not a brain-server relative proxy path, so a
 * pack can never point the app at an arbitrary host.
 */
export function offlineProxyUrl(brainUrl: string, relative: string, token: string): string {
  const path = String(relative || "");
  if (!path.startsWith("/") || path.startsWith("//")) return "";
  if (!/^\/v1\/offline\/(?:image|article)\?/.test(path)) return "";
  const base = String(brainUrl || "").replace(/\/+$/, "");
  const sep = path.includes("?") ? "&" : "?";
  return token ? `${base}${path}${sep}token=${encodeURIComponent(token)}` : `${base}${path}`;
}

/** What the bubble renders for one source: optional inline image plus link. */
export type OfflineSourceView = {
  title: string;
  tag: string;
  /** Proxy URL for the inline thumbnail, or "" when there is no picture. */
  imageUrl: string;
  /** Proxy URL for the article, or "" when this is a normal web source. */
  articleUrl: string;
};

export function offlineSourceView(
  source: OfflineSourceLike,
  brainUrl: string,
  token: string,
): OfflineSourceView {
  const title = String(source.title || "").trim();
  if (!source.offline) {
    return { title, tag: "", imageUrl: "", articleUrl: "" };
  }
  return {
    title,
    tag: offlineSourceTag(source),
    imageUrl: source.imageUrl ? offlineProxyUrl(brainUrl, source.imageUrl, token) : "",
    articleUrl: offlineProxyUrl(brainUrl, source.url, token),
  };
}
