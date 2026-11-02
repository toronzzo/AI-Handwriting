/**
 * Reaching the brain from a phone on the same Wi-Fi.
 *
 * The page is served from the Mac, so the brain lives on the *same host* as the
 * page. Deriving it from `window.location` means one build works on localhost
 * and on 192.168.x.x with no rebuild or setting.
 */

export const BRAIN_PORT = 8788;
export const WEB_PORT = 8081;

export type HostInfo = { hostname: string; protocol: string; port: string; href: string };

/** Pull the pieces we need out of a location-like object or a URL string. */
export function hostInfo(source: HostInfo | string): HostInfo {
  if (typeof source === "string") {
    try {
      const url = new URL(source);
      return { hostname: url.hostname, protocol: url.protocol, port: url.port, href: url.href };
    } catch {
      return { hostname: "", protocol: "", port: "", href: String(source) };
    }
  }
  return source;
}

export function isLoopbackHost(hostname: string): boolean {
  const host = String(hostname || "").toLowerCase().replace(/^\[|\]$/g, "");
  return host === "localhost" || host === "::1" || host === "127.0.0.1" || host.startsWith("127.");
}

/**
 * The brain URL for the page's own host. On a phone this is
 * http://<mac-ip>:8788; on the Mac it is http://127.0.0.1:8788.
 */
export function brainUrlFor(location: HostInfo | string): string {
  const info = hostInfo(location);
  const host = info.hostname;
  if (!host) return `http://127.0.0.1:${BRAIN_PORT}`;
  const scheme = info.protocol === "https:" ? "https:" : "http:";
  const formatted = host.includes(":") ? `[${host}]` : host;
  return `${scheme}//${formatted}:${BRAIN_PORT}`;
}

/** The URL to type on a phone, given the Mac's LAN address. */
export function phoneUrl(lanIp: string, port: number = WEB_PORT): string {
  const host = String(lanIp || "").trim();
  if (!host) return "";
  return `http://${host}:${port}`;
}

/**
 * Voice capture needs a secure page on iOS. `http://192.168…` is not one, but
 * `http://localhost` is, so the Mac keeps its microphone.
 */
export function microphoneAvailable(input: {
  protocol: string;
  hostname: string;
  isSecureContext?: boolean;
}): boolean {
  if (input.isSecureContext === true) return true;
  if (String(input.protocol) === "https:") return true;
  return isLoopbackHost(input.hostname);
}

/** True only for a 6-digit numeric code, so a typo never reaches the brain. */
export function isValidPairingCode(code: string): boolean {
  return /^\d{6}$/.test(String(code ?? "").trim());
}

export function normalizePairingCode(raw: string): string {
  return String(raw ?? "").replace(/\D+/g, "").slice(0, 6);
}
