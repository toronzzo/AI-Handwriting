/// <reference types="node" />
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, readdirSync } from "node:fs";
import { join, relative, sep } from "node:path";

/**
 * Product rules for the UI, enforced by reading the source itself (slice 11):
 * no game-y words in UI strings, the danger and stripe tokens stay out of the
 * Today screen, and health / mood / money surfaces never render red. Pure
 * node, no enums, no react-native import, so it runs under `node --test`.
 */

const ROOT = process.cwd();
const SRC = join(ROOT, "src");

/** Every .ts/.tsx file under src, recursively. */
function srcFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.tsx?$/.test(entry.name)) out.push(full);
    }
  };
  walk(SRC);
  return out;
}

function linesOf(file: string): string[] {
  return readFileSync(file, "utf8").split("\n");
}

/** `src/today/...` in a form safe to compare on every platform. */
function isUnderToday(file: string): boolean {
  const rel = relative(ROOT, file).split(sep).join("/");
  return rel.startsWith("src/today/");
}

test("no UI string uses the word streak", () => {
  for (const file of srcFiles()) {
    const rel = relative(ROOT, file).split(sep).join("/");
    // The rule is written inside this very file, so it reads itself out.
    if (rel === "src/productRules.test.ts") continue;
    linesOf(file).forEach((line, index) => {
      assert.ok(!/streak/i.test(line), `${rel}:${index + 1} uses the word streak: ${line.trim()}`);
    });
  }
});

test("the danger token and the stripe colours never appear under src/today", () => {
  for (const file of srcFiles()) {
    if (!isUnderToday(file)) continue;
    const rel = relative(ROOT, file).split(sep).join("/");
    linesOf(file).forEach((line, index) => {
      assert.ok(
        !/theme\.(danger|stripeYellow|stripeOrange|stripeRed)/.test(line),
        `${rel}:${index + 1} uses a banned token: ${line.trim()}`,
      );
    });
  }
});

test("the stripe colours are used in exactly one place: src/ui/Stripe.tsx", () => {
  for (const file of srcFiles()) {
    const rel = relative(ROOT, file).split(sep).join("/");
    const isStripe = rel === "src/ui/Stripe.tsx";
    linesOf(file).forEach((line, index) => {
      if (/theme\.stripe(Yellow|Orange|Red)/.test(line)) {
        assert.ok(isStripe, `${rel}:${index + 1} uses a stripe colour outside src/ui/Stripe.tsx: ${line.trim()}`);
      }
    });
  }
});

test("health, mood and money never render with the danger colour", () => {
  // The health rows live in ChatScreen and the mood pads in the room; a
  // style or JSX line that mentions health or mood may not carry danger.
  for (const rel of ["src/screens/ChatScreen.tsx", "src/room/RoomScreen.tsx"]) {
    linesOf(join(ROOT, rel)).forEach((line, index) => {
      if (/health|mood/i.test(line)) {
        assert.ok(
          !/theme\.danger/.test(line),
          `${rel}:${index + 1} renders health/mood with the danger colour: ${line.trim()}`,
        );
      }
    });
  }
  // Money is drawn by the Today screen (the radar and the quests); the rule
  // above already bans the danger token there, and this makes it explicit.
  for (const file of srcFiles()) {
    if (!isUnderToday(file)) continue;
    const rel = relative(ROOT, file).split(sep).join("/");
    linesOf(file).forEach((line, index) => {
      assert.ok(!/theme\.danger/.test(line), `${rel}:${index + 1} uses the danger colour: ${line.trim()}`);
    });
  }
});
