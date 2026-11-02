/**
 * Pairing for phones on the home network.
 *
 * The brain is bound to 0.0.0.0 so a phone can reach it, which means anything
 * on the Wi-Fi could too. A device must enter a 6-digit code shown on the Mac
 * once, then it keeps a token. Requests from this machine never need a code.
 */
import fs from "node:fs";
import path from "node:path";
import { randomBytes, randomInt, timingSafeEqual } from "node:crypto";

const TOKEN_RE = /^[A-Za-z0-9_-]{16,128}$/;
const MAX_ATTEMPTS = 8;
const ATTEMPT_WINDOW_MS = 10 * 60 * 1000;

export function devicesPath(root) {
  return path.join(root, "memory", "devices.json");
}

/** True when the caller is this machine. */
export function isLocalAddress(remoteAddress) {
  const raw = String(remoteAddress || "").trim();
  if (!raw) return false;
  const address = raw.replace(/^::ffff:/, "");
  return address === "::1" || address === "127.0.0.1" || address.startsWith("127.");
}

export function readDevices(root) {
  const file = devicesPath(root);
  if (!fs.existsSync(file)) return { devices: [] };
  try {
    const body = JSON.parse(fs.readFileSync(file, "utf8"));
    const devices = Array.isArray(body?.devices) ? body.devices : [];
    return {
      devices: devices
        .filter((row) => row && typeof row.token === "string" && TOKEN_RE.test(row.token))
        .map((row) => ({
          token: row.token,
          name: String(row.name || "device").slice(0, 60),
          pairedAt: Number(row.pairedAt) || 0,
          lastSeen: Number(row.lastSeen) || 0,
        })),
    };
  } catch {
    return { devices: [] };
  }
}

export function writeDevices(root, book) {
  const file = devicesPath(root);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify(book, null, 2)}\n`);
  fs.renameSync(temp, file);
}

function safeEqual(left, right) {
  const a = Buffer.from(String(left));
  const b = Buffer.from(String(right));
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** Rotating 6-digit code, readable on the Mac's Status screen. */
export function createPairingState(options = {}) {
  const { code = String(randomInt(0, 1_000_000)).padStart(6, "0"), now = Date.now() } = options;
  return { code, issuedAt: now, attempts: 0, windowStart: now };
}

export function currentCode(state, now = Date.now()) {
  if (!state) return "";
  if (now - state.windowStart > ATTEMPT_WINDOW_MS) {
    state.windowStart = now;
    state.attempts = 0;
  }
  return state.code;
}

/**
 * Decide what to do with one request.
 *
 * Returns `{ allow: true }`, `{ allow: false, status: 401 | 429, error }`, so the
 * HTTP layer stays a thin wrapper and the rules stay testable.
 */
export function authorizeRequest(input) {
  const {
    path: requestPath = "/",
    method = "GET",
    remoteAddress = "",
    token = "",
    book = { devices: [] },
    pairing = null,
    now = Date.now(),
  } = input;

  // The page itself, the manifest, icons and the pairing call are open.
  if (!String(requestPath).startsWith("/v1/")) return { allow: true };
  if (requestPath === "/v1/health") return { allow: true };
  if (requestPath === "/v1/pair") return { allow: true };
  if (isLocalAddress(remoteAddress)) return { allow: true };

  if (token && TOKEN_RE.test(token)) {
    const known = book.devices.find((device) => device.token === token);
    if (known) return { allow: true, device: known };
  }

  if (pairing && pairing.attempts >= MAX_ATTEMPTS) {
    return { allow: false, status: 429, error: "too many pairing attempts, try again later" };
  }
  void method;
  void now;
  return { allow: false, status: 401, error: "pair this device with the code shown on the Mac" };
}

/** Check a submitted code and mint a token when it matches. */
export function attemptPair(input) {
  const { code = "", pairing, now = Date.now(), name = "device" } = input;
  if (!pairing) return { ok: false, error: "pairing is not available", attempts: 0 };
  // A stale window resets the count before the limit is checked.
  currentCode(pairing, now);
  if (pairing.attempts >= MAX_ATTEMPTS) {
    return { ok: false, error: "too many pairing attempts, ask the Mac for a new code", attempts: pairing.attempts };
  }
  pairing.attempts += 1;
  if (!safeEqual(String(code).trim(), currentCode(pairing, now))) {
    return { ok: false, error: "that code is not right", attempts: pairing.attempts };
  }
  pairing.attempts = 0;
  const token = randomBytes(24).toString("base64url");
  return { ok: true, token, name: String(name || "device").slice(0, 60) };
}

export function touchDevice(book, token, now = Date.now()) {
  const device = book.devices.find((row) => row.token === token);
  if (device) device.lastSeen = now;
  return Boolean(device);
}

export function addDevice(book, token, name, now = Date.now()) {
  const devices = book.devices.filter((row) => row.token !== token);
  devices.push({ token, name, pairedAt: now, lastSeen: now });
  return { devices };
}

export function removeDevice(book, token) {
  return { devices: book.devices.filter((row) => row.token !== token) };
}

export { MAX_ATTEMPTS, TOKEN_RE };
