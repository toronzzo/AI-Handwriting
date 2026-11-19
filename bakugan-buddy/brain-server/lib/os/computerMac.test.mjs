import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  clickScript,
  createMacAdapter,
  frontmostScript,
  keysScript,
  MAC_CALL_TIMEOUT_MS,
} from "./computerMac.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));

/**
 * A fake execFile that records calls and answers from a function
 * (file, args) -> { stdout, stderr, error? }.
 */
function fakeExecFile(answers = () => ({ stdout: "", stderr: "" })) {
  const calls = [];
  const impl = (file, args, options, callback) => {
    calls.push({ file, args, options });
    const answer = answers(file, args);
    process.nextTick(() => {
      const error = answer.error ?? null;
      callback(error, answer.stdout ?? "", answer.stderr ?? "");
    });
  };
  return { calls, impl };
}

function adapterWith(answers) {
  const { calls, impl } = fakeExecFile(answers);
  const adapter = createMacAdapter({
    execFileImpl: impl,
    axScriptPath: path.join(HERE, "..", "..", "tools", "ax-dump.js"),
  });
  return { adapter, calls };
}

const isAxDump = (args) => args[0] === "-l" && args[1] === "JavaScript" && !args.includes("-e");
const isFrontmost = (args) => args[0] === "-e" && args[1].includes("frontmost is true");

test("every call is execFile with an argument array and a 5 s timeout", async () => {
  const { adapter, calls } = adapterWith((file, args) => {
    if (isAxDump(args)) return { stdout: '{"elements":[{"id":"e0","role":"AXButton","label":"Send"}]}' };
    return { stdout: "" };
  });
  await adapter.frontmost();
  await adapter.screenshot("/tmp/shot.jpg");
  await adapter.axSnapshot();
  await adapter.click(10, 20);
  await adapter.keys("cmd+c");
  await adapter.type("hello");
  await adapter.open("TextEdit");
  assert.ok(calls.length >= 7);
  for (const call of calls) {
    assert.equal(typeof call.file, "string");
    assert.ok(Array.isArray(call.args), "every call uses an argument array");
    assert.ok(call.args.every((arg) => typeof arg === "string"), "no non-string argument");
    assert.equal(call.options.timeout, MAC_CALL_TIMEOUT_MS, "every call has the timeout");
    assert.notEqual(call.options.shell, true, "the shell is never used");
    for (const arg of call.args) {
      assert.ok(!/[|]/.test(arg), `no shell pipe in argument: ${arg.slice(0, 60)}`);
      assert.ok(!arg.includes("&&"), `no shell and-chain in argument: ${arg.slice(0, 60)}`);
    }
  }
});

test("frontmost parses the app and window title", async () => {
  const { adapter } = adapterWith((file, args) =>
    isFrontmost(args) ? { stdout: "Mail\tInbox (3 messages)" } : { stdout: "" },
  );
  const front = await adapter.frontmost();
  assert.deepEqual(front, { app: "Mail", title: "Inbox (3 messages)" });
});

test("the frontmost script is a plain System Events AppleScript", () => {
  const script = frontmostScript();
  assert.ok(script.includes('tell application "System Events"'));
  assert.ok(script.includes("frontmost is true"));
  assert.ok(!/[|]/.test(script), "no shell pipe in the AppleScript");
  assert.ok(!script.includes("&&"), "no shell and-chain in the AppleScript");
});

test("the screenshot uses the exact screencapture argument array", async () => {
  const { adapter, calls } = adapterWith();
  await adapter.screenshot("/tmp/shot.jpg");
  assert.deepEqual(calls[0], {
    file: "screencapture",
    args: ["-x", "-t", "jpg", "/tmp/shot.jpg"],
    options: { timeout: MAC_CALL_TIMEOUT_MS, maxBuffer: 400000 },
  });
});

test("axSnapshot parses the JSON dump and caps nothing itself", async () => {
  const { adapter } = adapterWith((file, args) =>
    isAxDump(args)
      ? { stdout: '{"elements":[{"id":"e0","role":"AXButton","label":"Send","x":1,"y":2,"w":3,"h":4}]}' }
      : { stdout: "" },
  );
  const snapshot = await adapter.axSnapshot();
  assert.deepEqual(snapshot, { elements: [{ id: "e0", role: "AXButton", label: "Send", x: 1, y: 2, w: 3, h: 4 }] });
});

test("the click script posts a JXA mouse event at the point, with no shell", () => {
  const script = clickScript(10.4, 20.6);
  assert.ok(script.includes("CGPointMake(10, 21)"));
  assert.ok(script.includes("CGEventPost"));
  assert.throws(() => clickScript("junk", 0));
  assert.throws(() => clickScript(0, Number.NaN));
});

test("keysScript builds keystroke + modifiers and arrow key codes", () => {
  assert.equal(keysScript("cmd+c"), 'tell application "System Events" to keystroke "c" using {command down}');
  assert.equal(keysScript("cmd+shift+left"), "tell application \"System Events\" to key code 123 using {command down, shift down}");
  assert.equal(keysScript("return"), 'tell application "System Events" to keystroke "return"');
  assert.throws(() => keysScript("cmd+"), /no key/);
});

test("type escapes quotes and backslashes", async () => {
  const { adapter, calls } = adapterWith();
  await adapter.type('say "hi" \\ now');
  const script = calls[0].args[1];
  assert.ok(script.includes('say \\"hi\\" \\\\ now'));
});

test("open uses the plain open -a form", async () => {
  const { adapter, calls } = adapterWith();
  await adapter.open("TextEdit");
  assert.deepEqual(calls[0].args, ["-a", "TextEdit"]);
});

test("a permission error becomes the plain permission message", async () => {
  const { adapter } = adapterWith((file, args) =>
    isFrontmost(args)
      ? { error: new Error("exit 1"), stderr: "osascript is not allowed assistive access. (-25211)" }
      : { stdout: "" },
  );
  await assert.rejects(
    () => adapter.frontmost(),
    /Preyas needs Screen Recording and Accessibility permission for the frontmost app/,
  );
});

test("a screencapture permission error names screenshots", async () => {
  const { adapter } = adapterWith(() => ({ error: new Error("exit 1"), stderr: "screencapture: not permitted" }));
  await assert.rejects(() => adapter.screenshot("/tmp/x.jpg"), /permission for screenshots/);
});

test("a non-permission failure stays a plain error", async () => {
  const { adapter } = adapterWith((file, args) =>
    isFrontmost(args) ? { error: new Error("exit 1"), stderr: "execution error: nothing" } : { stdout: "" },
  );
  await assert.rejects(() => adapter.frontmost(), /computer call failed for the frontmost app/);
});

test("an unparsable ax dump is reported as the permission message", async () => {
  const { adapter } = adapterWith((file, args) => (isAxDump(args) ? { stdout: "<html>denied</html>" } : { stdout: "" }));
  await assert.rejects(() => adapter.axSnapshot(), /permission for reading the screen/);
});

test("the source never starts a shell: no exec(, no spawn(, no shell:", () => {
  const source = fs.readFileSync(path.join(HERE, "computerMac.mjs"), "utf8");
  assert.ok(!/exec\(|spawn\(|shell\s*:/.test(source), "computerMac.mjs must use execFile with argument arrays only");
});
