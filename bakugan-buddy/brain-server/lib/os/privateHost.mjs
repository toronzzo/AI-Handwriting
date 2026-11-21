/**
 * Which addresses are local or private, for the browser_navigate guard.
 *
 * Opening the brain itself (localhost, 127/8, the LAN) or any private range
 * always needs the user's Yes/No card first — and the hostname is resolved
 * BEFORE the verdict, so a public-looking name that resolves to a private
 * address (DNS rebinding or an /etc/hosts entry) is caught too.
 *
 * Pure checks here; the DNS lookup is injectable for tests.
 */
import dns from "node:dns";

/** hostname of an http(s) URL (IPv6 brackets stripped); "" when unusable. */
export function urlHost(url) {
  const text = String(url || "").trim();
  if (!text) return "";
  // A non-http(s) scheme (file:, ftp:) is not a navigation host; R7 blocks
  // those anyway. Scheme-less strings like "localhost:8081" get http://.
  const scheme = text.match(/^([a-z][a-z0-9+.-]*):\/\//i);
  if (scheme && !["http", "https"].includes(scheme[1].toLowerCase())) return "";
  for (const candidate of [text, `http://${text}`]) {
    try {
      const parsed = new URL(candidate);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") continue;
      return String(parsed.hostname || "").replace(/^\[|\]$/g, "");
    } catch {
      /* try the next form */
    }
  }
  return "";
}

/** True for the private IPv4 ranges, ::1, 0.0.0.0 and IPv4-mapped IPv6. */
export function isPrivateIp(ip) {
  const text = String(ip || "").trim();
  if (!text) return false;
  const mapped = text.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i);
  if (mapped) return isPrivateIp(mapped[1]);
  if (text === "::1" || text === "0:0:0:0:0:0:0:1") return true;
  const parts = text.split(".");
  if (parts.length !== 4) return false;
  const octets = parts.map((part) => Number(part));
  if (!octets.every((n) => Number.isInteger(n) && n >= 0 && n <= 255)) return false;
  const [a, b] = octets;
  if (a === 0) return true; // 0.0.0.0 ("this host")
  if (a === 10) return true; // 10/8
  if (a === 127) return true; // 127/8 (loopback)
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16/12
  if (a === 192 && b === 168) return true; // 192.168/16
  if (a === 169 && b === 254) return true; // 169.254/16 (link-local)
  return false;
}

/** localhost, *.local and literal private IPs — pure, no DNS. */
export function isPrivateHostname(host) {
  const text = String(host || "").trim().toLowerCase().replace(/\.$/, "");
  if (!text) return false;
  if (text === "localhost" || text.endsWith(".localhost")) return true;
  if (text.endsWith(".local")) return true;
  return isPrivateIp(text);
}

/** All addresses of one host, as strings. */
export async function lookupAddresses(host) {
  const found = await dns.promises.lookup(host, { all: true, verbatim: true });
  return (found || []).map((entry) => String(entry.address || ""));
}

/**
 * Resolve a navigation URL to { private, host, address }. The hostname is
 * checked literally first (localhost, .local, IP literals), then through DNS
 * so a public name resolving to a private IP is private too. A failed lookup
 * is not private — the navigation itself will fail at the browser.
 */
export async function resolveNavPrivacy(url, { lookup = lookupAddresses } = {}) {
  const host = urlHost(url);
  if (!host) return { private: false, host: "" };
  if (isPrivateHostname(host)) return { private: true, host };
  try {
    const addresses = await lookup(host);
    for (const address of addresses) {
      if (isPrivateIp(address)) return { private: true, host, address };
    }
  } catch {
    /* DNS failure: the browser will fail too; not a private leak */
  }
  return { private: false, host };
}
