/**
 * No loose colours: every UI colour must come from the theme tokens, not a
 * hard-coded literal. Reads the UI source files and fails if any `#rgb`,
 * `#rrggbb`, `#rrggbbaa` or `rgb(`/`rgba(` literal remains, except on lines
 * the 3D scene needs (marked with the `// 3d-colour` comment). Pure node with
 * no enums and no react-native import so it runs under `node --test`.
 */
/// <reference types="node" />
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/** What counts as a hard-coded colour literal. */
const COLOUR = /#[0-9a-fA-F]{3,8}\b|rgba?\(/;
/** Lines the 3D scene is allowed to keep (materials and lights). */
const ALLOWED = /3d-colour/;

/**
 * The UI source files to police. RoomScreen is read whole: its non-UI scene
 * colours all carry the `// 3d-colour` marker, so anything left without that
 * marker is a UI leak. PreyasHero's remaining hex values are 3D materials and
 * lights too, so it is covered by the same rule.
 */
const FILES = [
  "src/screens/ChatScreen.tsx",
  "src/screens/BenchmarkScreen.tsx",
  "src/screens/PreyasHero.tsx",
  "src/room/RoomScreen.tsx",
  "App.tsx",
];

test("no UI file leaves a hard-coded colour outside 3d-colour lines", () => {
  for (const rel of FILES) {
    const source = readFileSync(join(process.cwd(), rel), "utf8");
    const lines = source.split("\n");
    lines.forEach((line, index) => {
      if (!COLOUR.test(line)) return;
      assert.ok(
        ALLOWED.test(line),
        `${rel}:${index + 1} has a loose colour, theme token expected: ${line.trim()}`,
      );
    });
  }
});
