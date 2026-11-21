import { test } from "node:test";
import assert from "node:assert/strict";
import { isPrivateHostname, isPrivateIp, resolveNavPrivacy, urlHost } from "./privateHost.mjs";

test("isPrivateIp knows every required range and nothing public", () => {
  for (const ip of [
    "127.0.0.1",
    "127.255.255.254",
    "10.0.0.1",
    "10.255.255.255",
    "172.16.0.1",
    "172.31.255.254",
    "192.168.0.1",
    "192.168.31.73",
    "169.254.169.254",
    "0.0.0.0",
    "::1",
    "0:0:0:0:0:0:0:1",
    "::ffff:10.0.0.1",
    "::ffff:192.168.1.1",
  ]) {
    assert.equal(isPrivateIp(ip), true, `${ip} must be private`);
  }
  for (const ip of ["8.8.8.8", "93.184.216.34", "172.32.0.1", "172.15.255.255", "192.169.0.1", "11.0.0.1", "::ffff:8.8.8.8", "2001:4860:4860::8888"]) {
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
  assert.deepEqual(await resolveNavPrivacy("http://192.168.31.73:8081/", { lookup }), { private: true, host: "192.168.31.73" });
  assert.deepEqual(await resolveNavPrivacy("http://localhost:8081/", { lookup }), { private: true, host: "localhost" });
  assert.equal(lookedUp, 0, "literal private hosts never touch DNS");
});

test("resolveNavPrivacy: a public name resolving to a private IP is caught", async () => {
  const lookup = async () => ["10.0.0.5"];
  const result = await resolveNavPrivacy("https://innocent.example.com/x", { lookup });
  assert.equal(result.private, true);
  assert.equal(result.host, "innocent.example.com");
  assert.equal(result.address, "10.0.0.5");
});

test("resolveNavPrivacy: public DNS stays public, failed DNS fails open", async () => {
  const publicResult = await resolveNavPrivacy("https://example.com/", { lookup: async () => ["93.184.216.34"] });
  assert.equal(publicResult.private, false);
  const failing = await resolveNavPrivacy("https://no-such-host.invalid/", {
    lookup: async () => {
      throw new Error("ENOTFOUND");
    },
  });
  assert.equal(failing.private, false, "the browser will fail the navigation itself");
});
