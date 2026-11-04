/// <reference types="node" />
import assert from "node:assert/strict";
import test from "node:test";
import { MAIN_TABS, SETTINGS_ENTRY } from "./nav.ts";

test("the app renders three main tabs plus a settings entry", () => {
  assert.deepEqual(MAIN_TABS.map((t) => t.id), ["chat", "learn", "memory"]);
  assert.equal(SETTINGS_ENTRY.id, "settings");
});

test("every tab has a label, an icon and a friendly empty state", () => {
  for (const tab of MAIN_TABS) {
    assert.ok(tab.label.length > 0, `${tab.id} label`);
    assert.ok(tab.icon.length > 0, `${tab.id} icon`);
    assert.ok(tab.empty.length > 10, `${tab.id} empty sentence`);
    assert.ok(tab.example.startsWith("Try"), `${tab.id} example`);
  }
  assert.ok(SETTINGS_ENTRY.icon.length > 0);
});

test("chat stays the first tab so the app opens at home", () => {
  assert.equal(MAIN_TABS[0].id, "chat");
});
