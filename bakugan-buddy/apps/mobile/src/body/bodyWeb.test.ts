/**
 * The browser build of react-native-webview is a red "not supported" line.
 * Settings → Body must load body.html in an iframe instead.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const web = readFileSync(join(root, "src/body/BodyWebView.web.tsx"), "utf8");
const native = readFileSync(join(root, "src/body/BodyWebView.tsx"), "utf8");

test("the web body screen is an iframe of the generated body document", () => {
  assert.match(web, /srcDoc: BODY_HTML/);
  assert.match(web, /createElement\("iframe"/);
  assert.equal(web.includes('from "react-native-webview"'), false);
  for (const name of ["setEmotion", "setTheme", "setTalking", "react", "getMetrics", "getState"]) {
    assert.ok(web.includes(name), name);
  }
  assert.match(web, /export function BodyWebView/);
  assert.match(web, /export const BodyWebViewAPI/);
});

test("phones still host the body in a native WebView", () => {
  assert.match(native, /from "react-native-webview"/);
  assert.match(native, /source: \{ html: BODY_HTML \}/);
});
