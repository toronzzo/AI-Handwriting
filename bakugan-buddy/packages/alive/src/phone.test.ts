import assert from "node:assert/strict";
import test from "node:test";
import {
  BRAIN_PORT,
  brainUrlFor,
  isLoopbackHost,
  isValidPairingCode,
  microphoneAvailable,
  normalizePairingCode,
  phoneUrl,
} from "./phone.ts";

function loc(hostname: string, protocol = "http:", port = "8081") {
  return { hostname, protocol, port, href: `${protocol}//${hostname}:${port}/` };
}

test("the brain follows the page's host, so one build works on Mac and phone", () => {
  assert.equal(brainUrlFor(loc("127.0.0.1")), `http://127.0.0.1:${BRAIN_PORT}`);
  assert.equal(brainUrlFor(loc("localhost")), `http://localhost:${BRAIN_PORT}`);
  assert.equal(brainUrlFor(loc("192.168.31.73")), `http://192.168.31.73:${BRAIN_PORT}`);
  assert.equal(brainUrlFor("http://192.168.31.73:8081/"), `http://192.168.31.73:${BRAIN_PORT}`);
  assert.equal(brainUrlFor("https://preyas.example.com/"), `https://preyas.example.com:${BRAIN_PORT}`);
});

test("a bad or missing host falls back to this machine", () => {
  assert.equal(brainUrlFor("not a url"), `http://127.0.0.1:${BRAIN_PORT}`);
  assert.equal(brainUrlFor({ hostname: "", protocol: "", port: "", href: "" }), `http://127.0.0.1:${BRAIN_PORT}`);
});

test("loopback is recognised in its various spellings", () => {
  assert.equal(isLoopbackHost("localhost"), true);
  assert.equal(isLoopbackHost("127.0.0.1"), true);
  assert.equal(isLoopbackHost("::1"), true);
  assert.equal(isLoopbackHost("[::1]"), true);
  assert.equal(isLoopbackHost("192.168.31.73"), false);
});

test("the phone URL is built from the LAN address", () => {
  assert.equal(phoneUrl("192.168.31.73"), "http://192.168.31.73:8081");
  assert.equal(phoneUrl("192.168.31.73", 9000), "http://192.168.31.73:9000");
  assert.equal(phoneUrl(""), "");
});

test("the microphone is hidden on an insecure phone page and kept on the Mac", () => {
  assert.equal(microphoneAvailable({ protocol: "http:", hostname: "192.168.31.73" }), false);
  assert.equal(microphoneAvailable({ protocol: "http:", hostname: "127.0.0.1" }), true);
  assert.equal(microphoneAvailable({ protocol: "http:", hostname: "localhost" }), true);
  assert.equal(microphoneAvailable({ protocol: "https:", hostname: "192.168.31.73" }), true);
  assert.equal(microphoneAvailable({ protocol: "http:", hostname: "192.168.31.73", isSecureContext: true }), true);
});

test("pairing codes must be six digits", () => {
  assert.equal(isValidPairingCode("482913"), true);
  assert.equal(isValidPairingCode(" 482913 "), true);
  assert.equal(isValidPairingCode("48291"), false);
  assert.equal(isValidPairingCode("4829134"), false);
  assert.equal(isValidPairingCode("abcdef"), false);
  assert.equal(normalizePairingCode("48-29 13"), "482913");
  assert.equal(normalizePairingCode("12ab34cd56"), "123456");
});
