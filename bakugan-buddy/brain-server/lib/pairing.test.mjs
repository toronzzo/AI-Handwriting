import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  MAX_ATTEMPTS,
  addDevice,
  attemptPair,
  authorizeRequest,
  createPairingState,
  isLocalAddress,
  readDevices,
  removeDevice,
  writeDevices,
} from "./pairing.mjs";

function drive() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "preyas-pairing-"));
  return { root, done: () => fs.rmSync(root, { recursive: true, force: true }) };
}

const book = () => ({ devices: [] });
const PAIRED = { devices: [{ token: "tok_abcdefghijklmnop", name: "iPhone", pairedAt: 1, lastSeen: 1 }] };

test("this machine never needs a code", () => {
  assert.equal(isLocalAddress("127.0.0.1"), true);
  assert.equal(isLocalAddress("::1"), true);
  assert.equal(isLocalAddress("::ffff:127.0.0.1"), true);
  assert.equal(isLocalAddress("192.168.31.40"), false);
  for (const address of ["127.0.0.1", "::1", "::ffff:127.0.0.1"]) {
    const result = authorizeRequest({ path: "/v1/chats", remoteAddress: address, book: book() });
    assert.equal(result.allow, true, address);
  }
});

test("an unpaired phone on the Wi-Fi is refused", () => {
  const result = authorizeRequest({ path: "/v1/chats", remoteAddress: "192.168.31.40", book: book() });
  assert.equal(result.allow, false);
  assert.equal(result.status, 401);
  assert.match(result.error, /pair/i);
});

test("a paired token is accepted, a wrong or unknown one is not", () => {
  const ok = authorizeRequest({
    path: "/v1/chats",
    remoteAddress: "192.168.31.40",
    token: "tok_abcdefghijklmnop",
    book: PAIRED,
  });
  assert.equal(ok.allow, true);
  assert.equal(ok.device.name, "iPhone");

  for (const token of ["tok_wrongtokenthatislong", "", "short"]) {
    const result = authorizeRequest({ path: "/v1/chats", remoteAddress: "192.168.31.40", token, book: PAIRED });
    assert.equal(result.allow, false, token);
    assert.equal(result.status, 401);
  }
});

test("static files and the pairing endpoint stay open on the LAN", () => {
  for (const requestPath of ["/", "/index.html", "/manifest.webmanifest", "/assets/icon-192.png", "/v1/pair", "/v1/health"]) {
    const result = authorizeRequest({ path: requestPath, remoteAddress: "192.168.31.40", book: book() });
    assert.equal(result.allow, true, requestPath);
  }
  const other = authorizeRequest({ path: "/v1/notes", remoteAddress: "192.168.31.40", book: book() });
  assert.equal(other.allow, false);
});

test("the right code pairs, the wrong code is rejected", () => {
  const pairing = createPairingState({ code: "482913", now: 1000 });
  const good = attemptPair({ code: "482913", pairing, now: 2000, name: "iPhone" });
  assert.equal(good.ok, true);
  assert.match(good.token, /^[A-Za-z0-9_-]{16,}$/);
  assert.equal(good.name, "iPhone");

  const badPairing = createPairingState({ code: "482913", now: 1000 });
  const bad = attemptPair({ code: "111111", pairing: badPairing, now: 2000 });
  assert.equal(bad.ok, false);
  assert.equal(bad.attempts, 1);
  assert.match(bad.error, /not right/);
});

test("guessing is rate limited", () => {
  const pairing = createPairingState({ code: "482913", now: 1000 });
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    attemptPair({ code: "000000", pairing, now: 2000 });
  }
  const blocked = attemptPair({ code: "482913", pairing, now: 3000 });
  assert.equal(blocked.ok, false, "even the right code is refused while blocked");
  assert.match(blocked.error, /too many/i);

  const request = authorizeRequest({
    path: "/v1/chats",
    remoteAddress: "192.168.31.40",
    book: book(),
    pairing,
    now: 3000,
  });
  assert.equal(request.allow, false);
  assert.equal(request.status, 429);
});

test("the attempt window resets after a while", () => {
  const pairing = createPairingState({ code: "482913", now: 0 });
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    attemptPair({ code: "000000", pairing, now: 10 });
  }
  const later = attemptPair({ code: "482913", pairing, now: 20 * 60 * 1000 });
  assert.equal(later.ok, true, "a new window lets the real code through");
});

test("paired devices are stored and can be removed", () => {
  const { root, done } = drive();
  try {
    assert.deepEqual(readDevices(root).devices, []);
    writeDevices(root, addDevice(book(), "tok_abcdefghijklmnop", "iPhone", 500));
    const stored = readDevices(root);
    assert.equal(stored.devices.length, 1);
    assert.equal(stored.devices[0].name, "iPhone");
    writeDevices(root, removeDevice(stored, "tok_abcdefghijklmnop"));
    assert.deepEqual(readDevices(root).devices, []);
    assert.equal(fs.existsSync(`${path.join(root, "memory", "devices.json")}.tmp`), false);
  } finally {
    done();
  }
});

test("a malformed devices file does not break the brain", () => {
  const { root, done } = drive();
  try {
    fs.mkdirSync(path.join(root, "memory"), { recursive: true });
    fs.writeFileSync(path.join(root, "memory", "devices.json"), "{not json");
    assert.deepEqual(readDevices(root).devices, []);
    fs.writeFileSync(path.join(root, "memory", "devices.json"), JSON.stringify({ devices: [{ token: "short" }] }));
    assert.deepEqual(readDevices(root).devices, [], "a bad token is dropped");
  } finally {
    done();
  }
});
