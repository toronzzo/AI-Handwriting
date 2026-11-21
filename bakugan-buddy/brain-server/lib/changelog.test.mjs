import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { latestChangelog, parseChangelog, readChangelog } from "./changelog.mjs";

const SAMPLE = [
  "# What's new",
  "",
  "Friendly words.",
  "- 2026-11-21 — I can now use real tools. (#78)",
  "- 2026-11-21 — I can now switch models. (#79)",
  "- not a dated line",
  "* 2026-11-20 — I can now do something older.",
].join("\n");

test("parseChangelog keeps only dated I-can-now entries and reads the PR number", () => {
  const items = parseChangelog(SAMPLE);
  assert.equal(items.length, 3);
  assert.deepEqual(items[0], {
    id: "2026-11-21|I can now use real tools.",
    date: "2026-11-21",
    text: "I can now use real tools.",
    pr: 78,
  });
  assert.equal(items[2].pr, null);
  assert.equal(items[2].date, "2026-11-20");
});

test("parseChangelog removes duplicates and latestChangelog takes the newest five", () => {
  const lines = ["# h"];
  for (let i = 0; i < 8; i++) lines.push("- 2026-11-21 — I can now thing " + i + ".");
  lines.push("- 2026-11-21 — I can now thing 7.");
  const items = parseChangelog(lines.join("\n"));
  assert.equal(items.length, 8);
  assert.equal(latestChangelog(items).length, 5);
  assert.equal(latestChangelog(items)[4].text, "I can now thing 4.");
});

test("the repo changelog is seeded from merged PRs #78 to #93", () => {
  const file = fileURLToPath(new URL("../../CHANGELOG_PREYAS.md", import.meta.url));
  const items = readChangelog(file).items;
  assert.ok(items.length >= 15, "expected the seed entries, got " + items.length);
  for (const pr of [78, 79, 80, 81, 82, 83, 84, 85, 86, 87, 88, 89, 90, 91, 92, 93]) {
    assert.ok(items.some((item) => item.pr === pr), "missing PR #" + pr);
  }
  for (const item of items) assert.match(item.text, /^I can now/);
});

test("readChangelog tolerates a missing or broken file", () => {
  assert.deepEqual(readChangelog("/nonexistent/preyas/changelog.md").items, []);
  const fake = {
    existsSync: () => true,
    readFileSync: () => {
      throw new Error("boom");
    },
  };
  const broken = readChangelog("x", { fsImpl: fake });
  assert.deepEqual(broken.items, []);
  assert.match(broken.error, /boom/);
});
