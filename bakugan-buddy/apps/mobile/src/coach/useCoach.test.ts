/**
 * Coach must not refetch on every chat render. Chat passes a new getter
 * each time; if refresh depends on that function, a successful /v1/coach/state
 * sets state, renders again, and the effect starts another request.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const src = readFileSync(join(process.cwd(), "src/coach/useCoach.ts"), "utf8");

test("the coach getter is read from a ref, not from hook dependencies", () => {
  assert.match(src, /const getUrlRef = useRef\(getUrl\)/);
  assert.match(src, /getUrlRef\.current = getUrl/);
  assert.match(src, /getUrlRef\.current\(\)/);
  assert.equal(/\[\s*getUrl\s*,/.test(src), false, "refresh or turn must not list getUrl as a dependency");
  assert.equal(/\[\s*getUrl\s*\]/.test(src), false);
});

test("coach state is loaded once per refresh identity, not on every getter change", () => {
  assert.match(src, /useEffect\(\(\) => \{\s*void refresh\(\);\s*\}, \[refresh\]\)/);
  assert.match(src, /\}, \[applyState\]\);/);
});
