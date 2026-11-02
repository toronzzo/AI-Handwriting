/**
 * proxy.mjs sits in brain-server/, so alive sources are ../packages/...
 * Files in lib/ are one level deeper and correctly use ../../packages/...
 * A wrong ../ level crashes node with ERR_MODULE_NOT_FOUND at startup.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const here = path.dirname(new URL(import.meta.url).pathname);
const brain = path.resolve(here, "..");

function relativeImports(file) {
  const text = fs.readFileSync(file, "utf8");
  const specs = [];
  const re = /from\s+["'](\.[^"']+)["']/g;
  let match = re.exec(text);
  while (match) {
    specs.push(match[1]);
    match = re.exec(text);
  }
  return specs;
}

function resolves(fromFile, spec) {
  const base = path.resolve(path.dirname(fromFile), spec);
  const candidates = [base, `${base}.mjs`, `${base}.js`, `${base}.ts`, `${base}.json`];
  for (let i = 0; i < candidates.length; i++) {
    if (fs.existsSync(candidates[i])) return true;
  }
  return false;
}

test("brain-server relative imports point at files that exist", () => {
  const files = [path.join(brain, "proxy.mjs")];
  const lib = path.join(brain, "lib");
  for (const name of fs.readdirSync(lib)) {
    if (name.endsWith(".mjs") && !name.endsWith(".test.mjs")) files.push(path.join(lib, name));
  }
  const misses = [];
  for (let i = 0; i < files.length; i++) {
    const specs = relativeImports(files[i]);
    for (let j = 0; j < specs.length; j++) {
      if (!resolves(files[i], specs[j])) misses.push(`${path.relative(brain, files[i])} -> ${specs[j]}`);
    }
  }
  assert.deepEqual(misses, []);
});

test("proxy.mjs reaches alive sources one directory up, not two", () => {
  const text = fs.readFileSync(path.join(brain, "proxy.mjs"), "utf8");
  assert.match(text, /from "\.\.\/packages\/alive\/src\/speech\.ts"/);
  assert.match(text, /from "\.\.\/packages\/alive\/src\/longMemory\.ts"/);
  assert.equal(text.includes('from "../../packages/alive/'), false);
});
