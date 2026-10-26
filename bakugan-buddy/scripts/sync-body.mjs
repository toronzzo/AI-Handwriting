#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const html = fs.readFileSync(path.join(root, "body.html"), "utf8");
const out = path.join(root, "apps/mobile/src/bodyHtml.generated.ts");
fs.writeFileSync(
  out,
  `/* auto-generated from bakugan-buddy/body.html — run scripts/sync-body.mjs */\nexport const BODY_HTML = ${JSON.stringify(html)};\n`,
);
fs.copyFileSync(path.join(root, "body.html"), path.join(root, "..", "body.html"));
console.log("synced body.html →", out);
