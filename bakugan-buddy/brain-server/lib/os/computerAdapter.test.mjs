import { test } from "node:test";
import assert from "node:assert/strict";
import { capSnapshot, createFakeAdapter, AX_LABEL_MAX, AX_SNAPSHOT_MAX } from "./computerAdapter.mjs";

test("the fake adapter returns canned answers and records every call", async () => {
  const adapter = createFakeAdapter({
    frontmost: () => ({ app: "Mail", title: "Inbox" }),
    axSnapshot: () => ({ elements: [{ id: "e0", role: "AXButton", label: "Send", x: 1, y: 2, w: 3, h: 4 }] }),
  });
  assert.deepEqual(await adapter.frontmost(), { app: "Mail", title: "Inbox" });
  assert.deepEqual(await adapter.axSnapshot(), { elements: [{ id: "e0", role: "AXButton", label: "Send", x: 1, y: 2, w: 3, h: 4 }] });
  assert.deepEqual(await adapter.screenshot("/tmp/shot.jpg"), { ok: true, path: "/tmp/shot.jpg" });
  assert.deepEqual(await adapter.click(5, 6), { ok: true });
  assert.deepEqual(await adapter.keys("cmd+c"), { ok: true });
  assert.deepEqual(await adapter.type("hi"), { ok: true });
  assert.deepEqual(await adapter.open("TextEdit"), { ok: true });
  assert.deepEqual(adapter.calls, [
    ["frontmost"],
    ["axSnapshot"],
    ["screenshot", "/tmp/shot.jpg"],
    ["click", 5, 6],
    ["keys", "cmd+c"],
    ["type", "hi"],
    ["open", "TextEdit"],
  ]);
});

test("script overrides can make the fake adapter do work", async () => {
  const adapter = createFakeAdapter({
    screenshot: async (filePath) => {
      const fs = await import("node:fs");
      fs.writeFileSync(filePath, "fake-jpeg");
      return { ok: true, path: filePath };
    },
    click: async (x, y) => ({ ok: true, clicked: [x, y] }),
  });
  const shot = await adapter.screenshot("/tmp/fake.jpg");
  assert.equal(shot.ok, true);
  assert.deepEqual(await adapter.click(1, 2), { ok: true, clicked: [1, 2] });
});

test("the fake adapter defaults never throw", async () => {
  const adapter = createFakeAdapter();
  assert.deepEqual(await adapter.frontmost(), { app: "FakeApp", title: "Fake Window" });
  assert.deepEqual(await adapter.axSnapshot(), { elements: [] });
  assert.equal((await adapter.click(0, 0)).ok, true);
});

test("capSnapshot caps the count and the label length", () => {
  const big = Array.from({ length: 100 }, (_, i) => ({
    id: `element-${i}`,
    role: "AXButton",
    label: `label ${i} ${"x".repeat(200)}`,
    x: i,
    y: i,
    w: i,
    h: i,
  }));
  const capped = capSnapshot(big);
  assert.equal(capped.elements.length, AX_SNAPSHOT_MAX);
  const first = capped.elements[0];
  assert.equal(first.label.length, AX_LABEL_MAX);
  assert.equal(first.id, "element-0");
  assert.equal(first.role, "AXButton");
  assert.equal(first.x, 0);
});

test("capSnapshot tolerates junk rows", () => {
  const capped = capSnapshot([null, {}, "junk"]);
  assert.equal(capped.elements.length, 3);
  assert.equal(capped.elements[0].label, "");
  assert.equal(capped.elements[0].x, 0);
  assert.deepEqual(capSnapshot(null), { elements: [] });
});
