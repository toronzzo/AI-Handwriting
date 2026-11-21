/**
 * Which addresses are local or private, for the browser_navigate guard.
 *
 * Opening the brain itself (localhost, 127/8, the LAN) or any private range
 * always needs the user's Yes/No card first — and the hostname is resolved
 * BEFORE the verdict, so a public-looking name that resolves to a private
 * address (DNS rebinding or an /etc/hosts entry) is caught too. The check
 * fails CLOSED: a host whose DNS cannot be resolved counts as private.
 *
 * Redirects are followed hop by hop, each hop resolved again, so a public
 * page redirecting to a private address — or a host that answers with a
 * private IP on a second lookup — is caught before the browser opens it.
 *
 * Pure checks here; the DNS lookup and the HTTP fetch are injectable.
 */
import dns from "node:dns";
import net from "node:net";

const IPV4_PRIVATE = new net.BlockList();
for (const [network, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.168.0.0", 16],
]) {
  IPV4_PRIVATE.addSubnet(network, prefix, "ipv4");
}

/** Expand one IPv6 address into its 8 16-bit groups; null when unusable. */
function ipv6Groups(text) {
  const t = String(text).trim().toLowerCase();
  if (!t || t.includes(":::") || (t.match(/::/g) || []).length > 1) return null;
  let left = t;
  let right = "";
  if (t.includes("::")) [left, right] = t.split("::");
  const parse = (part) => {
    if (part === "") return [];
    const groups = [];
    for (const item of part.split(":")) {
      if (item.includes(".")) {
        const octets = item.split(".").map((n) => Number(n));
        if (octets.length !== 4 || octets.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null;
        groups.push(octets[0] * 256 + octets[1], octets[2] * 256 + octets[3]);
      } else {
        const n = parseInt(item, 16);
        if (!Number.isFinite(n) || n < 0 || n > 0xffff) return null;
        groups.push(n);
      }
    }
    return groups;
  };
  const head = parse(left);
  const tail = parse(right);
  if (head === null || tail === null) return null;
  const fill = 8 - (head.length + tail.length);
  if (fill < 0) return null;
  return [...head, ...new Array(fill).fill(0), ...tail];
}

/** ::1 (and its long forms). */
function isIpv6Loopback(groups) {
  return groups.join(",") === "0,0,0,0,0,0,0,1";
}

/** fc00::/7 — the unique-local range (fc..fd). */
function isIpv6Ula(groups) {
  return (groups[0] & 0xfe00) === 0xfc00;
}

/** fe80::/10 — link-local. */
function isIpv6LinkLocal(groups) {
  return (groups[0] & 0xffc0) === 0xfe80;
}

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

/**
 * True for the private IPv4 ranges (0/8, 10/8, 100.64/10, 127/8, 169.254/16,
 * 172.16/12, 192.168/16), ::1, IPv6 ULA fc00::/7, link-local fe80::/10 and
 * IPv4-mapped IPv6 (::ffff:a.b.c.d — the embedded IPv4 is what counts).
 */
export function isPrivateIp(ip) {
  const text = String(ip || "").trim().toLowerCase().replace(/^\[|\]$/g, "");
  if (!text) return false;
  const mapped = text.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (mapped) return isPrivateIp(mapped[1]);
  const version = net.isIP(text);
  if (version === 4) return IPV4_PRIVATE.check(text);
  if (version === 6) {
    const groups = ipv6Groups(text);
    if (!groups) return false;
    return isIpv6Loopback(groups) || isIpv6Ula(groups) || isIpv6LinkLocal(groups);
  }
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
 * so a public name resolving to a private IP is private too. A failed
 * lookup FAILS CLOSED: the verdict is private, so the card is asked rather
 * than letting an unresolved host through.
 */
export async function resolveNavPrivacy(url, { lookup = lookupAddresses } = {}) {
  const host = urlHost(url);
  if (!host) return { private: true, host: "unknown", address: null };
  if (isPrivateHostname(host)) return { private: true, host, address: null };
  try {
    const addresses = await lookup(host);
    for (const address of addresses) {
      if (isPrivateIp(address)) return { private: true, host, address };
    }
    if (addresses.length === 0) return { private: true, host, address: null };
  } catch {
    // DNS failure is a failure: treat the host as private and ask.
    return { private: true, host, address: null };
  }
  return { private: false, host, address: null };
}

/**
 * Follow a navigation's redirect chain hop by hop, resolving each hop's host
 * freshly (so a rebinding host that turns private on a later lookup is
 * caught), and return the verdict for the whole chain:
 * { private, host, address, hops } — private when ANY hop is private,
 * with `host`/`address` naming the hop that made it private.
 * Never throws: a network failure mid-chain stops the trace; the verdict
 * for the hops resolved so far (plus the fail-closed DNS rule) decides.
 */
export async function traceNavigation(startUrl, { lookup = lookupAddresses, fetchImpl = fetch, maxHops = 5 } = {}) {
  const hops = [];
  let url = String(startUrl || "");
  for (let step = 0; step <= maxHops; step += 1) {
    if (!url) break;
    const nav = await resolveNavPrivacy(url, { lookup });
    hops.push({ url, host: nav.host, address: nav.address, private: nav.private });
    if (nav.private) break;
    try {
      const res = await fetchImpl(url, { method: "HEAD", redirect: "manual", signal: AbortSignal.timeout(5_000) });
      const status = Number(res.status);
      const location = typeof res.headers?.get === "function" ? res.headers.get("location") : "";
      if ([301, 302, 303, 307, 308].includes(status) && location) {
        url = new URL(location, url).toString();
        continue;
      }
    } catch {
      /* the network failed mid-trace; the hops so far decide */
    }
    break;
  }
  const privateHop = hops.find((hop) => hop.private);
  if (privateHop) return { private: true, host: privateHop.host, address: privateHop.address, hops };
  const first = hops[0];
  return { private: false, host: first ? first.host : "", address: null, hops };
}
