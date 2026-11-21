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
  localTokenPath,
  pairingCodePath,
  readLocalToken,
  readDevices,
  requestToken,
  removeDevice,
  writeLocalToken,
  writePairingCode,
  writeDevices,
} from "./pairing.mjs";

function drive() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "preyas-pairing-"));
  return { root, done: () => fs.rmSync(root, { recursive: true, force: true }) };
}

const book = () => ({ devices: [] });
const PAIRED = { devices: [{ token: "tok_abcdefghijklmnop", name: "iPhone", pairedAt: 1, lastSeen: 1 }] };

test("loopback requests require a valid paired token", () => {
  for (const remoteAddress of ["127.0.0.1", "::1", "::ffff:127.0.0.1"]) {
    const result = authorizeRequest({ path: "/v1/chats", remoteAddress, book: book() });
    assert.equal(result.allow, false, remoteAddress);
    assert.equal(result.status, 401, remoteAddress);
  }
});

test("an unpaired phone on the Wi-Fi is refused", () => {
  const result = authorizeRequest({ path: "/v1/chats", remoteAddress: "192.168.31.40", book: book() });
  assert.equal(result.allow, false);
  assert.equal(result.status, 401);
  assert.match(result.error, /pair/i);
});

test("a paired token is accepted from local and network callers; invalid tokens are refused", () => {
  for (const remoteAddress of ["127.0.0.1", "::1", "192.168.31.40"]) {
    const ok = authorizeRequest({
      path: "/v1/chats",
      remoteAddress,
      token: "tok_abcdefghijklmnop",
      book: PAIRED,
    });
    assert.equal(ok.allow, true, remoteAddress);
    assert.equal(ok.device.name, "iPhone");
  }

  for (const token of ["tok_wrongtokenthatislong", "", "short"]) {
    const result = authorizeRequest({ path: "/v1/chats", remoteAddress: "127.0.0.1", token, book: PAIRED });
    assert.equal(result.allow, false, token);
    assert.equal(result.status, 401);
  }
});

test("static files and the pairing endpoint stay open on the LAN", () => {
  for (const requestPath of ["/", "/index.html", "/manifest.webmanifest", "/assets/icon-192.png", "/v1/pair", "/v1/health"]) {
    const result = authorizeRequest({ path: requestPath, remoteAddress: "192.168.31.40", book: book() });
    assert.equal(result.allow, true, requestPath);
  }
  for (const requestPath of ["/v1/notes", "/v1/phone", "/v1/restart"]) {
    const other = authorizeRequest({ path: requestPath, remoteAddress: "127.0.0.1", book: book() });
    assert.equal(other.allow, false, requestPath);
  }
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

test("pairing material is stored with owner-only permissions", () => {
  const { root, done } = drive();
  try {
    assert.deepEqual(readDevices(root).devices, []);
    writeDevices(root, addDevice(book(), "tok_abcdefghijklmnop", "iPhone", 500));
    writeLocalToken(root, "tok_abcdefghijklmnop");
    writePairingCode(root, "482913");
    const stored = readDevices(root);
    assert.equal(stored.devices.length, 1);
    assert.equal(stored.devices[0].name, "iPhone");
    const tokenPath = localTokenPath(root);
    assert.equal(fs.readFileSync(tokenPath, "utf8"), "tok_abcdefghijklmnop\n");
    assert.equal(readLocalToken(root), "tok_abcdefghijklmnop");
    assert.equal(fs.statSync(tokenPath).mode & 0o777, 0o600);
    assert.equal(fs.readFileSync(pairingCodePath(root), "utf8"), "482913\n");
    assert.equal(fs.statSync(pairingCodePath(root)).mode & 0o777, 0o600);
    assert.equal(fs.statSync(path.join(root, "memory", "devices.json")).mode & 0o777, 0o600);
    assert.throws(() => writeLocalToken(root, "invalid"), /invalid local pairing token/);
    assert.throws(() => writePairingCode(root, "bad"), /invalid pairing code/);
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

test("the offline image and article GETs may carry the token in the query", () => {
  // An <img> tag and a new tab cannot send X-Preyas-Token.
  assert.equal(requestToken({ path: "/v1/offline/image", method: "GET", queryToken: "tok" }), "tok");
  assert.equal(requestToken({ path: "/v1/offline/article", method: "GET", queryToken: "tok" }), "tok");
});

test("no other route accepts a token in the query", () => {
  for (const route of ["/v1/chat", "/v1/search", "/v1/offline/search", "/v1/os/tasks", "/v1/settings/spend"]) {
    assert.equal(
      requestToken({ path: route, method: "GET", queryToken: "tok" }),
      "",
      route + " must not accept a query token",
    );
  }
  // A POST to a proxy path is not a browser image load either.
  assert.equal(requestToken({ path: "/v1/offline/image", method: "POST", queryToken: "tok" }), "");
});

test("a header token always wins and is used on every route", () => {
  assert.equal(requestToken({ path: "/v1/chat", method: "GET", headerToken: "h", queryToken: "q" }), "h");
  assert.equal(requestToken({ path: "/v1/offline/image", method: "GET", headerToken: "h", queryToken: "q" }), "h");
  assert.equal(requestToken({}), "");
});

test("a query token on an unpaired route still fails authorization", () => {
  const gate = authorizeRequest({
    path: "/v1/offline/search",
    method: "GET",
    token: requestToken({ path: "/v1/offline/search", method: "GET", queryToken: "abcdefghijklmnop" }),
    book: { devices: [] },
  });
  assert.equal(gate.allow, false);
  assert.equal(gate.status, 401);
});

test("a paired device is allowed on the offline proxy routes", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "preyas-pair-offline-"));
  try {
    const token = addDevice({ devices: [] }, "abcdefghijklmnop").devices[0].token;
    // Pictures and articles arrive through a browser load, so the query works.
    for (const route of ["/v1/offline/image", "/v1/offline/article"]) {
      const gate = authorizeRequest({
        path: route,
        method: "GET",
        token: requestToken({ path: route, method: "GET", queryToken: token }),
        book: { devices: [{ token }] },
      });
      assert.equal(gate.allow, true, route + " should allow a paired device");
    }
    // The search call is made by the app, which sends the header.
    const search = authorizeRequest({
      path: "/v1/offline/search",
      method: "GET",
      token: requestToken({ path: "/v1/offline/search", method: "GET", headerToken: token }),
      book: { devices: [{ token }] },
    });
    assert.equal(search.allow, true, "offline search should allow a paired app");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
