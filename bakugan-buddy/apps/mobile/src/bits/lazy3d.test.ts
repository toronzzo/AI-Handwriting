/**
 * Structural tests for the 8-bit look (slice 8A). Pure node - the files are
 * read as text, nothing is imported, so these run under node --test with no
 * React or React Native.
 */
/// <reference types="node" />
import assert from "node:assert/strict";
import test from "node:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const SRC = join(ROOT, "src");

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...walk(path));
    else if (/\.(ts|tsx)$/.test(name)) out.push(path);
  }
  return out;
}

const FILES = walk(SRC);
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

test("Preyas3D lazy-loads the 3D screen and nothing else imports it", () => {
  // The 3D screen (react-three-fiber) exists at the same path as before.
  assert.ok(FILES.includes(join(SRC, "screens/PreyasHero.tsx")));
  const wrapper = read("src/screens/Preyas3D.tsx");
  assert.match(wrapper, /lazy\(/, "The 3D screen must be loaded through React.lazy");
  assert.match(wrapper, /import\(\"\.\/PreyasHero\"\)/, "The 3D screen must be a dynamic import()");
  const importers = FILES.filter((path) => {
    const rel = path.slice(ROOT.length + 1).replace(/\\/g, "/");
    if (rel === "src/screens/Preyas3D.tsx" || rel === "src/screens/PreyasHero.tsx") return false;
    const text = readFileSync(path, "utf8");
    return /import[^;]*["'](?:\.\/|\.\.\/)PreyasHero["']/.test(text);
  });
  assert.deepEqual(importers, [], "only Preyas3D.tsx may point at the 3D screen");
});
