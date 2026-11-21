/// <reference types="node" />
import assert from "node:assert/strict";
import test from "node:test";
import {
  ABOUT_CHANGELOG_LIMIT,
  ABOUT_GROUPS,
  aboutHeadline,
  aboutItems,
  changelogPreview,
  hasAnything,
  normalizeCapabilities,
  serviceDots,
} from "./about.ts";

const BODY = {
  builtAt: "2026-11-21T12:00:00Z",
  currentModel: "small",
  tools: [
    { id: "files", label: "Files", detail: "read and write files", available: true },
    { id: "browser", label: "Browser", detail: "open pages", available: false },
  ],
  models: [{ id: "small", label: "8B local", detail: "running now", current: true }],
  media: [{ id: "sounds", label: "Reaction sounds", detail: "6 sounds" }],
  services: [
    { id: "brain", label: "brain-server", port: 8788, running: true },
    { id: "web", label: "Expo web", port: 8081, running: false },
  ],
  changelog: [
    { date: "2026-11-21", text: "I can now do one." },
    { date: "2026-11-21", text: "I can now do two." },
    { date: "2026-11-20", text: "not an entry" },
    { date: "2026-11-20", text: "I can now do three." },
  ],
};

test("normalizeCapabilities keeps the good rows and filters non-changelog text", () => {
  const view = normalizeCapabilities(BODY);
  assert.equal(view.builtAt, "2026-11-21T12:00:00Z");
  assert.equal(view.tools.length, 2);
  assert.equal(view.tools[1].available, false);
  assert.equal(view.models[0].current, true);
  assert.equal(view.changelog.length, 3);
  assert.equal(changelogPreview(view).length, 3);
  assert.equal(changelogPreview(view, 1)[0].text, "I can now do one.");
  assert.equal(ABOUT_CHANGELOG_LIMIT, 5);
});

test("about lists only what is available, and the headline counts it", () => {
  const view = normalizeCapabilities(BODY);
  assert.deepEqual(aboutItems(view, "tools").map((item) => item.id), ["files"]);
  assert.equal(aboutItems(view, "models").length, 1);
  assert.equal(aboutItems(view, "media").length, 1);
  assert.equal(hasAnything(view), true);
  assert.equal(aboutHeadline(view), "1 tool · 1 brain · 3 recent notes");
  assert.deepEqual(serviceDots(view), [
    { label: "brain-server", running: true },
    { label: "Expo web", running: false },
  ]);
  assert.equal(ABOUT_GROUPS.length, 3);
});

test("an older brain with no capability body is handled kindly", () => {
  const view = normalizeCapabilities(undefined);
  assert.equal(hasAnything(view), false);
  assert.equal(view.tools.length, 0);
  assert.equal(changelogPreview(view).length, 0);
  assert.match(aboutHeadline(view), /has not told me/);
});

test("malformed entries are skipped instead of breaking the card", () => {
  const view = normalizeCapabilities({
    tools: [{ label: "" }, null, { label: "Files" }],
    services: [{ label: 42 }, { id: "brain", running: true }],
    changelog: [{ date: "2026-11-21", text: "hello" }, null],
  });
  assert.deepEqual(view.tools.map((row) => row.label), ["Files"]);
  assert.equal(view.services.length, 1);
  assert.equal(view.services[0].label, "brain");
  assert.equal(view.changelog.length, 0);
});
