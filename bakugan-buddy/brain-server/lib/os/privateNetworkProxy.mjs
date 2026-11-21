import http from "node:http";
import net from "node:net";
import { isPrivateHostname, isPrivateIp, lookupAddresses } from "./privateHost.mjs";

function normalizedHost(host) {
  return String(host || "").replace(/^\[|\]$/g, "").toLowerCase();
}

function destinationKey({ host, port, address }) {
  return `${normalizedHost(host)}:${Number(port)}:${String(address || "").toLowerCase()}`;
}

function parseHttpUrl(value) {
  try {
    const url = new URL(String(value || ""));
    if (url.protocol !== "http:") return null;
    return url;
  } catch {
    return null;
  }
}

function parseConnectTarget(value) {
  try {
    const url = new URL(`http://${String(value || "")}`);
    const port = Number(url.port);
    if (!url.hostname || !Number.isInteger(port) || port < 1 || port > 65535) return null;
    return { host: normalizedHost(url.hostname), port };
  } catch {
    return null;
  }
}

function writeText(res, status, text) {
  res.writeHead(status, { "content-type": "text/plain; charset=utf-8", connection: "close" });
  res.end(text);
}

/** A loopback HTTP CONNECT proxy that checks and pins every destination. */
export function createPrivateNetworkProxy({
  lookup = lookupAddresses,
  connectSocket = (options) => net.connect(options),
} = {}) {
  let server = null;
  let address = null;
  let taskContext = null;

  async function resolveDestination(host, port, url) {
    const normalized = normalizedHost(host);
    if (!normalized || !Number.isInteger(port) || port < 1 || port > 65535) {
      return { blocked: true, reason: "invalid destination" };
    }

    let addresses;
    try {
      addresses = net.isIP(normalized) ? [normalized] : await lookup(normalized);
    } catch {
      return { blocked: true, reason: `could not resolve ${normalized}` };
    }
    if (!Array.isArray(addresses) || addresses.length === 0) {
      return { blocked: true, reason: `could not resolve ${normalized}` };
    }

    const privateAddress = addresses.find((ip) => isPrivateIp(ip)) || (isPrivateHostname(normalized) ? addresses[0] : "");
    const destination = { host: normalized, port, address: privateAddress || addresses[0], url };
    if (privateAddress) {
      const key = destinationKey(destination);
      if (!taskContext?.approved.has(key)) {
        let approved = false;
        if (typeof taskContext?.onPrivateRequest === "function") {
          try {
            approved = await taskContext.onPrivateRequest(destination);
          } catch {
            approved = false;
          }
        }
        if (!approved) return { blocked: true, reason: `private destination ${normalized}:${port} (${privateAddress}) was not approved` };
        taskContext.approved.add(key);
      }
    }
    return { address: destination.address };
  }

  async function handleHttpRequest(req, res) {
    const url = parseHttpUrl(req.url);
    if (!url) return writeText(res, 400, "Invalid or unsupported proxy URL.");
    const port = Number(url.port) || 80;
    const resolved = await resolveDestination(url.hostname, port, url.toString());
    if (resolved.blocked) return writeText(res, 451, `Blocked by the private-network guard: ${resolved.reason}.`);
    if (req.aborted || res.destroyed) return;

    const headers = { ...req.headers, host: url.host, connection: "close" };
    delete headers["proxy-authorization"];
    delete headers["proxy-connection"];
    const agent = new http.Agent({ keepAlive: false });
    agent.createConnection = (_options, callback) => connectSocket({ host: resolved.address, port }, callback);
    const upstream = http.request(
      {
        protocol: "http:",
        hostname: url.hostname,
        port,
        method: req.method,
        path: `${url.pathname}${url.search}`,
        headers,
        agent,
      },
      (upstreamRes) => {
        res.writeHead(upstreamRes.statusCode || 502, upstreamRes.headers);
        upstreamRes.pipe(res);
      },
    );
    upstream.on("error", (error) => {
      if (!res.headersSent) writeText(res, 502, `Proxy connection failed: ${error.message}`);
      else res.destroy(error);
    });
    req.on("aborted", () => upstream.destroy());
    req.pipe(upstream);
  }

  async function handleConnect(req, clientSocket, head) {
    const target = parseConnectTarget(req.url);
    if (!target) {
      clientSocket.end("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n");
      return;
    }
    const resolved = await resolveDestination(target.host, target.port, `https://${target.host}:${target.port}/`);
    if (resolved.blocked) {
      clientSocket.end(`HTTP/1.1 451 Unavailable For Legal Reasons\r\nConnection: close\r\n\r\nBlocked by the private-network guard: ${resolved.reason}.`);
      return;
    }
    if (clientSocket.destroyed) return;
    const upstream = connectSocket({ host: resolved.address, port: target.port });
    upstream.once("connect", () => {
      clientSocket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      if (head.length) upstream.write(head);
      clientSocket.pipe(upstream);
      upstream.pipe(clientSocket);
    });
    upstream.on("error", () => {
      clientSocket.end("HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n");
    });
    clientSocket.on("error", () => upstream.destroy());
    clientSocket.on("close", () => upstream.destroy());
  }

  return {
    async start() {
      if (server) return address;
      server = http.createServer((req, res) => {
        void handleHttpRequest(req, res).catch((error) => {
          if (!res.headersSent) writeText(res, 502, `Proxy failed: ${error.message}`);
          else res.destroy(error);
        });
      });
      server.on("connect", (req, socket, head) => {
        void handleConnect(req, socket, head).catch(() => {
          socket.end("HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n");
        });
      });
      await new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", () => {
          server.removeListener("error", reject);
          const endpoint = server.address();
          address = `http://127.0.0.1:${endpoint.port}`;
          resolve();
        });
      });
      return address;
    },
    setTaskContext(context) {
      taskContext = context
        ? {
            taskId: String(context.taskId || ""),
            onPrivateRequest: context.onPrivateRequest,
            approved: new Set((context.approvedDestinations || []).map(destinationKey)),
          }
        : null;
    },
    approveDestination(destination, taskId) {
      if (!taskContext || taskContext.taskId !== String(taskId || "")) return false;
      taskContext.approved.add(destinationKey(destination));
      return true;
    },
    async close() {
      taskContext = null;
      if (!server) return;
      const closing = server;
      server = null;
      address = null;
      await new Promise((resolve) => closing.close(resolve));
    },
  };
}
