import { test } from "node:test";
import assert from "node:assert/strict";
import { isPrivateHostname, isPrivateIp, resolveNavPrivacy, traceNavigation, urlHost } from "./privateHost.mjs";

test("isPrivateIp knows every required range and nothing public", () => {
  for (const ip of [
    "127.0.0.1",
    "127.255.255.254",
    "10.0.0.1",
    "10.255.255.255",
    "100.64.0.1",
    "100.100.100.100",
    "100.127.255.254",
    "172.16.0.1",
    "172.31.255.254",
    "192.168.0.1",
    "192.168.31.73",
    "169.254.169.254",
    "0.0.0.0",
    "::1",
    "0:0:0:0:0:0:0:1",
    "::ffff:10.0.0.1",
    "::ffff:100.64.0.1",
    "::ffff:192.168.1.1",
    "fc00::1",
    "fd12:3456:7890::abcd",
    "fe80::1",
    "fe80::a00:27ff:fe4e:66a1",
  ]) {
    assert.equal(isPrivateIp(ip), true, `${ip} must be private`);
  }
  for (const ip of [
    "8.8.8.8",
    "93.184.216.34",
    "100.63.255.255",
    "100.128.0.1",
    "172.32.0.1",
    "172.15.255.255",
    "192.169.0.1",
    "11.0.0.1",
    "::ffff:8.8.8.8",
    "::",
    "2001:4860:4860::8888",
    "fbff::1",
    "fec0::1",
  ]) {
    assert.equal(isPrivateIp(ip), false, `${ip} must not be private`);
  }
});

test("isPrivateHostname catches localhost, .local and IP literals", () => {
  for (const host of ["localhost", "localhost.", "preyas.local", "192.168.31.73", "127.0.0.1", "::1"]) {
    assert.equal(isPrivateHostname(host), true, `${host} must be private`);
  }
  for (const host of ["example.com", "preyas.com", "en.wikipedia.org"]) {
    assert.equal(isPrivateHostname(host), false, `${host} must not be private`);
  }
});

test("urlHost pulls the hostname out of http(s) URLs and strips brackets", () => {
  assert.equal(urlHost("https://example.com/x"), "example.com");
  assert.equal(urlHost("http://192.168.31.73:8081/login"), "192.168.31.73");
  assert.equal(urlHost("http://[::1]:8788/"), "::1");
  assert.equal(urlHost("localhost:8081"), "localhost");
  assert.equal(urlHost("file:///etc/passwd"), "");
  assert.equal(urlHost(""), "");
});

test("resolveNavPrivacy: a private IP or localhost asks without DNS", async () => {
  let lookedUp = 0;
  const lookup = async (host) => {
    lookedUp += 1;
    return ["8.8.8.8"];
  };
  assert.deepEqual(await resolveNavPrivacy("http://192.168.31.73:8081/", { lookup }), { private: true, host: "192.168.31.73", address: null });
  assert.deepEqual(await resolveNavPrivacy("http://localhost:8081/", { lookup }), { private: true, host: "localhost", address: null });
  assert.equal(lookedUp, 0, "literal private hosts never touch DNS");
});

test("resolveNavPrivacy: a public name resolving to a private IP is caught", async () => {
  const lookup = async () => ["10.0.0.5"];
  const result = await resolveNavPrivacy("https://innocent.example.com/x", { lookup });
  assert.equal(result.private, true);
  assert.equal(result.host, "innocent.example.com");
  assert.equal(result.address, "10.0.0.5");
});

test("traceNavigation: a public page redirecting to a private address is caught", async () => {
  const fetchImpl = async (url) => {
    if (String(url).includes("start.example")) {
      return { status: 302, headers: { get: (key) => (key === "location" ? "http://192.168.1.10/final" : "") } };
    }
    return { status: 200, headers: { get: () => "" } };
  };
  const lookup = async (host) => (host === "start.example" ? ["93.184.216.34"] : []);
  const trace = await traceNavigation("https://start.example/", { lookup, fetchImpl });
  assert.equal(trace.private, true);
  assert.equal(trace.host, "192.168.1.10", "the private hop is the one reported");
  assert.equal(trace.hops.length, 2);
  assert.equal(trace.hops[0].private, false);
  assert.equal(trace.hops[1].private, true);
});

test("traceNavigation: rebinding is caught because every hop re-resolves", async () => {
  const answers = new Map([
    ["https://x.example/", "https://x.example/final"],
    ["https://x.example/final", null],
  ]);
  const fetchImpl = async (url) => {
    const next = answers.get(String(url));
    if (next) return { status: 302, headers: { get: (key) => (key === "location" ? next : "") } };
    return { status: 200, headers: { get: () => "" } };
  };
  const seen = [];
  const lookup = async (host) => {
    seen.push(host);
    // First lookup public, second lookup private: the host changed its answer.
    return seen.length === 1 ? ["93.184.216.34"] : ["10.0.0.5"];
  };
  const trace = await traceNavigation("https://x.example/", { lookup, fetchImpl });
  assert.equal(trace.private, true, "the second lookup must be caught");
  assert.equal(seen.length, 2, "the same host was resolved again for the next hop");
  assert.equal(trace.host, "x.example");
  assert.equal(trace.address, "10.0.0.5");
});

test("traceNavigation: a fully public chain stays public", async () => {
  const fetchImpl = async (url) => {
    if (String(url).includes("/start")) {
      return { status: 301, headers: { get: (key) => (key === "location" ? "https://final.example/done" : "") } };
    }
    return { status: 200, headers: { get: () => "" } };
  };
  const lookup = async (host) => (host === "final.example" ? ["93.184.216.34"] : ["8.8.8.8"]);
  const trace = await traceNavigation("https://start.example/start", { lookup, fetchImpl });
  assert.equal(trace.private, false);
  assert.equal(trace.hops.length, 2);
});

test("resolveNavPrivacy: public DNS stays public, failed DNS fails closed", async () => {
  const publicResult = await resolveNavPrivacy("https://example.com/", { lookup: async () => ["93.184.216.34"] });
  assert.equal(publicResult.private, false);
  const failing = await resolveNavPrivacy("https://no-such-host.invalid/", {
    lookup: async () => {
      throw new Error("ENOTFOUND");
    },
  });
  assert.equal(failing.private, true, "an unresolved host is treated as private and asks");
  const empty = await resolveNavPrivacy("https://empty.example/", { lookup: async () => [] });
  assert.equal(empty.private, true, "no addresses is also a failure");
});
