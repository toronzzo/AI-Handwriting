import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import net from "node:net";
import { once } from "node:events";
import { createPrivateNetworkProxy } from "./privateNetworkProxy.mjs";

async function listen(server) {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return server.address().port;
}

function proxyGet(proxyPort, url) {
  return new Promise((resolve, reject) => {
    const request = http.get({
      hostname: "127.0.0.1",
      port: proxyPort,
      path: url,
      headers: { host: new URL(url).host, "proxy-connection": "close" },
    }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => resolve({ status: response.statusCode, headers: response.headers, body: Buffer.concat(chunks).toString() }));
    });
    request.on("error", reject);
  });
}

test("the proxy blocks a GET-only redirect before contacting its private destination", async () => {
  let headRequests = 0;
  let privateRequests = 0;
  const destination = http.createServer((req, res) => {
    privateRequests += 1;
    res.end("private");
  });
  const privatePort = await listen(destination);
  const publicServer = http.createServer((req, res) => {
    if (req.method === "HEAD") {
      headRequests += 1;
      res.writeHead(200).end();
    } else {
      res.writeHead(302, { location: `http://private.example:${privatePort}/secret` }).end();
    }
  });
  const publicPort = await listen(publicServer);
  const proxy = createPrivateNetworkProxy({
    lookup: async (host) => host === "public.example" ? ["93.184.216.34"] : ["127.0.0.1"],
    connectSocket: ({ host, port }, callback) =>
      net.connect({ host: host === "93.184.216.34" ? "127.0.0.1" : host, port: host === "93.184.216.34" ? publicPort : port }, callback),
  });
  const endpoint = await proxy.start();
  const proxyPort = Number(new URL(endpoint).port);
  try {
    const first = await proxyGet(proxyPort, "http://public.example/start");
    assert.equal(first.status, 302);
    const blocked = await proxyGet(proxyPort, first.headers.location);
    assert.equal(blocked.status, 451);
    assert.match(blocked.body, /private-network guard/);
    assert.equal(headRequests, 0, "the request path is a browser-style GET, not a HEAD probe");
    assert.equal(privateRequests, 0, "the private origin received no request");
  } finally {
    await proxy.close();
    await Promise.all([
      new Promise((resolve) => publicServer.close(resolve)),
      new Promise((resolve) => destination.close(resolve)),
    ]);
  }
});
test("the proxy blocks a private HTTPS CONNECT before opening its socket", async () => {
  let privateConnections = 0;
  const privateServer = net.createServer(() => {
    privateConnections += 1;
  });
  const privatePort = await listen(privateServer);
  const proxy = createPrivateNetworkProxy({
    lookup: async () => ["127.0.0.1"],
    connectSocket: (options) => net.connect(options),
  });
  const endpoint = await proxy.start();
  const socket = net.connect({ host: "127.0.0.1", port: Number(new URL(endpoint).port) });
  try {
    await once(socket, "connect");
    socket.write(`CONNECT private.example:${privatePort} HTTP/1.1\r\nHost: private.example:${privatePort}\r\n\r\n`);
    const [response] = await once(socket, "data");
    assert.match(response.toString(), /^HTTP\/1\.1 451/);
    assert.match(response.toString(), /private-network guard/);
    assert.equal(privateConnections, 0, "the private HTTPS socket was never opened");
  } finally {
    socket.destroy();
    await proxy.close();
    await new Promise((resolve) => privateServer.close(resolve));
  }
});

test("the proxy rejects IPv6 unspecified destinations before connect", async () => {
  let connections = 0;
  const proxy = createPrivateNetworkProxy({
    lookup: async (host) => host === "0:0:0:0:0:0:0:0" ? ["0:0:0:0:0:0:0:0"] : ["::"],
    connectSocket: () => {
      connections += 1;
      throw new Error("must not connect");
    },
  });
  const endpoint = await proxy.start();
  const proxyPort = Number(new URL(endpoint).port);
  try {
    for (const url of ["http://[::]/", "http://[0:0:0:0:0:0:0:0]/"]) {
      const blocked = await proxyGet(proxyPort, url);
      assert.equal(blocked.status, 451);
      assert.match(blocked.body, /private-network guard/);
    }
    assert.equal(connections, 0, "unspecified IPv6 never opened a socket");
  } finally {
    await proxy.close();
  }
});

test("the proxy waits for a task-scoped card before allowing a private HTTPS CONNECT", async () => {
  let privateConnections = 0;
  let requested;
  const privateServer = net.createServer((socket) => {
    privateConnections += 1;
    socket.end("private-origin");
  });
  const privatePort = await listen(privateServer);
  const proxy = createPrivateNetworkProxy({ lookup: async () => ["127.0.0.1"] });
  proxy.setTaskContext({
    taskId: "task-1",
    onPrivateRequest: async (target) => {
      requested = target;
      return true;
    },
  });
  const endpoint = await proxy.start();
  const socket = net.connect({ host: "127.0.0.1", port: Number(new URL(endpoint).port) });
  try {
    await once(socket, "connect");
    socket.write(`CONNECT private.example:${privatePort} HTTP/1.1\r\nHost: private.example:${privatePort}\r\n\r\n`);
    const responsePromise = new Promise((resolve, reject) => {
      let response = "";
      socket.on("data", (chunk) => {
        response += chunk.toString();
        if (response.includes("private-origin")) resolve(response);
      });
      socket.on("error", reject);
    });
    const response = await responsePromise;
    assert.match(response, /^HTTP\/1\.1 200 Connection Established/);
    assert.equal(privateConnections, 1);
    assert.equal(requested.host, "private.example");
    assert.equal(requested.port, privatePort);
    assert.equal(requested.address, "127.0.0.1");
  } finally {
    socket.destroy();
    await proxy.close();
    await new Promise((resolve) => privateServer.close(resolve));
  }
});

test("the proxy re-resolves and blocks a rebinding address before connecting", async () => {
  let privateRequests = 0;
  let lookups = 0;
  const privateServer = http.createServer((_req, res) => {
    privateRequests += 1;
    res.end("private");
  });
  const privatePort = await listen(privateServer);
  const publicServer = http.createServer((_req, res) => res.end("public"));
  const publicPort = await listen(publicServer);
  const proxy = createPrivateNetworkProxy({
    lookup: async () => {
      lookups += 1;
      return lookups === 1 ? ["93.184.216.34"] : ["127.0.0.1"];
    },
    connectSocket: ({ host, port }, callback) =>
      net.connect({ host: host === "93.184.216.34" ? "127.0.0.1" : host, port: host === "93.184.216.34" ? publicPort : port }, callback),
  });
  const endpoint = await proxy.start();
  const proxyPort = Number(new URL(endpoint).port);
  try {
    const first = await proxyGet(proxyPort, `http://rebinding.example:${privatePort}/resource`);
    assert.equal(first.status, 200);
    assert.equal(first.body, "public");
    const blocked = await proxyGet(proxyPort, `http://rebinding.example:${privatePort}/resource`);
    assert.equal(blocked.status, 451);
    assert.equal(lookups, 2, "each request gets a fresh DNS answer");
    assert.equal(privateRequests, 0, "the rebound private origin received no request");
  } finally {
    await proxy.close();
    await Promise.all([
      new Promise((resolve) => publicServer.close(resolve)),
      new Promise((resolve) => privateServer.close(resolve)),
    ]);
  }
});

test("private approval is scoped to one host, port, address, and task", async () => {
  let privateRequests = 0;
  let lookups = 0;
  const approvals = [];
  const privateServer = http.createServer((_req, res) => {
    privateRequests += 1;
    res.end("private");
  });
  const privatePort = await listen(privateServer);
  const proxy = createPrivateNetworkProxy({
    lookup: async () => {
      lookups += 1;
      return lookups < 3 ? ["127.0.0.1"] : ["127.0.0.2"];
    },
    connectSocket: ({ host, port }, callback) =>
      net.connect({ host: host === "127.0.0.1" ? "127.0.0.1" : host, port }, callback),
  });
  proxy.setTaskContext({
    taskId: "task-1",
    approvedDestinations: [{ host: "router.local", port: privatePort, address: "127.0.0.1" }],
    onPrivateRequest: async (target) => {
      approvals.push(target);
      return false;
    },
  });
  const endpoint = await proxy.start();
  const proxyPort = Number(new URL(endpoint).port);
  try {
    const first = await proxyGet(proxyPort, `http://router.local:${privatePort}/`);
    assert.equal(first.status, 200);
    const sameDestination = await proxyGet(proxyPort, `http://router.local:${privatePort}/`);
    assert.equal(sameDestination.status, 200);
    const rebound = await proxyGet(proxyPort, `http://router.local:${privatePort}/`);
    assert.equal(rebound.status, 451);
    assert.equal(privateRequests, 2);
    assert.equal(approvals.length, 1, "the changed address needs its own confirmation");
    assert.equal(approvals[0].address, "127.0.0.2");
    assert.equal(approvals[0].host, "router.local");
    assert.equal(approvals[0].port, privatePort);
  } finally {
    await proxy.close();
    await new Promise((resolve) => privateServer.close(resolve));
  }
});
