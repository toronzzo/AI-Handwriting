/// <reference types="node" />
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { chatPaneVisible, chatSectionFor, chatStaysMounted } from "./stage.ts";

test("chat stays mounted on Today and Brain, and is hidden while they are open", () => {
  for (const section of ["today", "chat", "learn", "memory", "brain", "settings"] as const) {
    assert.equal(chatStaysMounted(section, false), true, section);
    assert.equal(chatStaysMounted(section, true), true, section + " advanced");
  }
  assert.equal(chatPaneVisible("brain", false), false);
  assert.equal(chatPaneVisible("today", false), false);
  assert.equal(chatPaneVisible("chat", false), true);
  assert.equal(chatPaneVisible("learn", false), true);
  assert.equal(chatPaneVisible("memory", false), true);
  assert.equal(chatPaneVisible("settings", false), true);
  assert.equal(chatPaneVisible("chat", true), false);
  assert.equal(chatSectionFor("brain"), "chat");
  assert.equal(chatSectionFor("learn"), "learn");
});

test("the shell hides chat instead of unmounting it", () => {
  const app = readFileSync(join(process.cwd(), "App.tsx"), "utf8");
  assert.match(app, /chatStaysMounted/);
  assert.match(app, /chatPaneVisible/);
  assert.equal(app.includes('section === "brain" ? (\n            <BrainScreen />'), false);
});
