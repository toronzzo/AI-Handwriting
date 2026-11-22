/**
 * A short TCP connect budget for optional LAN helpers.
 *
 * A sleeping Windows laptop accepts no handshake. Waiting on the system TCP
 * timeout would freeze the mic, a chat turn, or an embeddings call. This probe
 * gives up after CONNECT_TIMEOUT_MS and leaves the caller free to fall back.
 * It does not limit how long a connected request may run.
 */
import net from "node:net";

/** About three seconds: long enough for a waking LAN host, short enough to skip a sleeper. */
export const CONNECT_TIMEOUT_MS = 3_000;

export function endpointOf(url) {
  const parsed = new URL(url);
  const port = parsed.port ? Number(parsed.port) : parsed.protocol === "https:" ? 443 : 80;
  return { host: parsed.hostname, port };
}

/**
 * True when a TCP handshake to `url` finishes within `timeoutMs`.
 * False on a bad URL, a refused port, or a timeout. Never throws.
 * `netImpl` is the test seam (the real `node:net` module by default).
 */
export function connectWithTimeout(url, timeoutMs = CONNECT_TIMEOUT_MS, netImpl = net) {
  let host = "";
  let port = 0;
  try {
    const endpoint = endpointOf(url);
    host = endpoint.host;
    port = endpoint.port;
  } catch {
    return Promise.resolve(false);
  }
  if (!host || !Number.isFinite(port) || port <= 0) return Promise.resolve(false);

  return new Promise((resolve) => {
    let settled = false;
    const finish = (ok) => {
      if (settled) return;
      settled = true;
      resolve(ok);
    };
    let socket;
    try {
      socket = netImpl.connect({ host, port });
    } catch {
      finish(false);
      return;
    }
    const timer = setTimeout(() => {
      try {
        socket.destroy();
      } catch {
        /* already closed */
      }
      finish(false);
    }, timeoutMs);
    const clear = () => clearTimeout(timer);
    if (!socket || typeof socket.once !== "function") {
      clear();
      finish(false);
      return;
    }
    socket.once("connect", () => {
      clear();
      try {
        socket.end();
      } catch {
        /* ignore */
      }
      finish(true);
    });
    socket.once("error", () => {
      clear();
      try {
        socket.destroy();
      } catch {
        /* ignore */
      }
      finish(false);
    });
  });
}
