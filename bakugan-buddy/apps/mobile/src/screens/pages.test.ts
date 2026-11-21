/**
 * Desktop pages share one width. Learn, Memory and Settings all spread their
 * content with the same capped, centred column (PAGE_MAX / pageColumn), so a
 * wide window never turns the Memory list into an edge-to-edge wall of cards.
 *
 * Reads the screen source, like noLooseColours does, because the cap is JSX
 * style wiring rather than a value a unit call could exercise.
 */
/// <reference types="node" />
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PAGE_MAX } from "../layout.ts";

const SCREEN = readFileSync(join(process.cwd(), "src/screens/ChatScreen.tsx"), "utf8");

/** The Memory section's source, from its branch to the next one. */
function memorySection(): string {
  // The render branch, not the effect that refreshes notes on the same tab.
  const start = SCREEN.indexOf('section === "memory" ? (');
  assert.ok(start > 0, "the Memory section exists");
  const end = SCREEN.indexOf('section === "settings" ? (', start);
  return SCREEN.slice(start, end > start ? end : start + 4000);
}

test("the Memory page uses the same 900px centred cap as Learn", () => {
  assert.equal(PAGE_MAX, 900);
  const memory = memorySection();
  // The heading block and the scrolling body are both centred at the cap.
  assert.match(memory, /\[styles\.memHead, page\]/, "the Memory header uses the page column");
  assert.match(memory, /\[styles\.pad, page\]/, "the Memory list uses the page column");
  // Learn keeps the identical treatment, so the two tabs line up.
  const learnStart = SCREEN.indexOf('section === "learn" ? (');
  assert.ok(learnStart > 0, "the Learn section exists");
  const learn = SCREEN.slice(learnStart, learnStart + 600);
  assert.match(learn, /\[styles\.pad, page\]/);
});

test("every page cap comes from one helper, not a literal per screen", () => {
  const memory = memorySection();
  assert.equal(/maxWidth:\s*9\d\d/.test(memory), false, "no loose 900 in the Memory section");
  assert.match(SCREEN, /const page = pageColumn\(width\)/);
});
