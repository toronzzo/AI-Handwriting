/// <reference types="node" />
import assert from "node:assert/strict";
import test from "node:test";
import {
  CANNOT_TURN_ON_NOTE,
  TURN_OFF_CONFIRM,
  canRestartBrain,
  canTurnOff,
  normalizePowerStatus,
  powerDot,
  powerErrorMessage,
  powerSummary,
  ramLabel,
  runningCount,
  serviceLine,
} from "./power.ts";

const STATUS = {
  ok: true,
  checkedAt: "2026-11-21T12:00:00Z",
  services: [
    { name: "web", label: "Expo web", port: 8081, running: false, health: false, ramMb: 0, available: false, detail: "stopped" },
    { name: "brain", label: "brain-server", port: 8788, running: true, health: true, ramMb: 64 },
    { name: "llama", label: "llama-server", port: 8790, running: true, health: false, ramMb: 2048 },
    { name: "bogus" },
    null,
  ],
  autostart: { installed: true, supported: true, path: "/tmp/preyas.plist" },
};

test("normalizePowerStatus sorts the known order and drops bad rows", () => {
  const status = normalizePowerStatus(STATUS);
  assert.deepEqual(status.services.map((row) => row.name), ["llama", "brain", "web", "bogus"]);
  assert.equal(status.services[0].ramMb, 2048);
  assert.equal(status.autostart.installed, true);
  assert.equal(status.ok, true);
});

test("normalizePowerStatus survives a broken or empty body", () => {
  const empty = normalizePowerStatus(null);
  assert.deepEqual(empty.services, []);
  assert.equal(empty.autostart.installed, false);
  assert.equal(powerSummary(empty), "Checking the Mac…");
  assert.equal(canTurnOff(empty), false);
});

test("dots say on, warn or off", () => {
  assert.equal(powerDot({ running: true, health: true } as never), "on");
  assert.equal(powerDot({ running: true, health: false } as never), "warn");
  assert.equal(powerDot({ running: false, health: true } as never), "off");
});

test("RAM is short and readable, and service lines carry state, port and RAM", () => {
  assert.equal(ramLabel(512), "512 MB");
  assert.equal(ramLabel(2048), "2.0 GB");
  assert.equal(ramLabel(undefined), "0 MB");
  const brain = { name: "brain", label: "Brain", port: 8788, running: true, health: true, ramMb: 64 };
  assert.equal(serviceLine(brain), "running · :8788 · 64 MB");
  assert.equal(serviceLine({ ...brain, running: false }), "stopped · :8788");
  assert.equal(serviceLine({ ...brain, running: false, available: false, detail: "brain files missing" }), "not set up · brain files missing");
  assert.match(serviceLine({ ...brain, health: false }), /not answering/);
});

test("summary, counts and disabled states match what the user sees", () => {
  const status = normalizePowerStatus(STATUS);
  assert.equal(runningCount(status), 2);
  assert.equal(powerSummary(status), "2 of 4 services are running.");
  assert.equal(canRestartBrain(status), true);
  assert.equal(canTurnOff(status), true);
  assert.equal(powerSummary(normalizePowerStatus({ services: [{ name: "brain", running: false }] })), "Preyas is off.");
});

test("errors distinguish a timeout from an unreachable Mac", () => {
  const timeout = new Error("too slow");
  timeout.name = "TimeoutError";
  assert.match(powerErrorMessage(timeout), /taking too long/);
  assert.match(powerErrorMessage(new Error("network")), /did not answer/);
});

test("the turn-off copy is explicit that the app cannot turn itself back on", () => {
  assert.match(TURN_OFF_CONFIRM.body, /double-click Preyas ON/i);
  assert.match(CANNOT_TURN_ON_NOTE, /cannot turn itself back on/i);
});
