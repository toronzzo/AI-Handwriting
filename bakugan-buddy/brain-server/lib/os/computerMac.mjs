/**
 * B6 computer control: the REAL macOS adapter. Every call goes through
 * execFile with an argument array and a timeout — never a shell string.
 *
 * UNVERIFIED ON THIS MAC: every command below runs for real only when the
 * user walks through the supervised first run in docs/COMPUTER_USE.md.
 * screencapture needs the Screen Recording permission; osascript needs the
 * Accessibility permission, both granted to the app that launched the brain
 * proxy (Terminal or the launcher). A permission error is turned into the
 * plain message "Preyas needs Screen Recording and Accessibility permission
 * for <app>".
 */
import { execFile as defaultExecFile } from "node:child_process";

export const MAC_CALL_TIMEOUT_MS = 5_000;
export const MAC_OUTPUT_CAP = 100_000;

const PERMISSION_RE = /assistive access|not allowed|not permitted|is not allowed to send|denied|privacy/i;

function escapeAppleScript(text) {
  return String(text).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function permissionMessage(appHint) {
  return `Preyas needs Screen Recording and Accessibility permission for ${appHint}`;
}

/** Promise wrapper around execFile: timeout + output cap, never a shell. */
function run(execFileImpl, file, args, timeoutMs) {
  return new Promise((resolve) => {
    const onDone = (error, stdout, stderr) => {
      resolve({
        error,
        stdout: String(stdout || "").slice(0, MAC_OUTPUT_CAP),
        stderr: String(stderr || "").slice(0, MAC_OUTPUT_CAP),
      });
    };
    try {
      execFileImpl(file, args, { timeout: timeoutMs, maxBuffer: MAC_OUTPUT_CAP * 4 }, onDone);
    } catch (error) {
      onDone(error, "", "");
    }
  });
}

function failOr(error, out, what) {
  if (!error) return null;
  const text = `${out.stdout}\n${out.stderr}\n${error instanceof Error ? error.message : String(error)}`;
  if (PERMISSION_RE.test(text)) {
    return new Error(permissionMessage(what));
  }
  return new Error(`computer call failed for ${what}: ${text.trim().slice(0, 300)}`);
}

const KEY_CODES = { left: 123, right: 124, down: 125, up: 126 };
const MOD_NAMES = {
  cmd: "command",
  command: "command",
  ctrl: "control",
  control: "control",
  opt: "option",
  alt: "option",
  option: "option",
  shift: "shift",
  fn: "function",
};

/** The keystroke AppleScript for a combo like "cmd+c". UNVERIFIED. */
export function keysScript(combo) {
  const parts = String(combo)
    .toLowerCase()
    .trim()
    .split(/[\s,+]+/)
    .map((part) => part.trim())
    .filter(Boolean);
  const mods = [];
  let key = "";
  for (const part of parts) {
    if (MOD_NAMES[part]) mods.push(`${MOD_NAMES[part]} down`);
    else key = part;
  }
  if (!key) throw new Error(`no key in combo "${combo}"`);
  const using = mods.length ? ` using {${mods.join(", ")}}` : "";
  if (KEY_CODES[key] !== undefined) {
    return `tell application "System Events" to key code ${KEY_CODES[key]}${using}`;
  }
  return `tell application "System Events" to keystroke "${escapeAppleScript(key)}"${using}`;
}

/** The JXA mouse-click script for a screen point. UNVERIFIED. */
export function clickScript(x, y) {
  const px = Math.round(Number(x));
  const py = Math.round(Number(y));
  if (!Number.isFinite(px) || !Number.isFinite(py)) throw new Error("click needs a screen point");
  return [
    "ObjC.import('CoreGraphics');",
    `const pt = $.CGPointMake(${px}, ${py});`,
    "const src = $.CGEventSourceCreate($.kCGEventSourceStateHIDSystemState);",
    "const down = $.CGEventCreateMouseEvent(src, $.kCGEventLeftMouseDown, pt, $.kCGMouseButtonLeft);",
    "const up = $.CGEventCreateMouseEvent(src, $.kCGEventLeftMouseUp, pt, $.kCGMouseButtonLeft);",
    "$.CGEventPost($.kCGHIDEventTap, down);",
    "$.CGEventPost($.kCGHIDEventTap, up);",
  ].join("\n");
}

/** The AppleScript that reads the frontmost app + window title. UNVERIFIED. */
export function frontmostScript() {
  return [
    'tell application "System Events"',
    "  set p to first application process whose frontmost is true",
    "  set appName to name of p",
    '  set winTitle to ""',
    "  try",
    "    set winTitle to name of first window of p",
    "  end try",
    '  return appName & "\t" & winTitle',
    "end tell",
  ].join("\n");
}

export function createMacAdapter({
  execFileImpl = defaultExecFile,
  axScriptPath,
  timeoutMs = MAC_CALL_TIMEOUT_MS,
} = {}) {
  if (!axScriptPath) throw new Error("createMacAdapter needs axScriptPath (brain-server/tools/ax-dump.js)");

  return {
    // UNVERIFIED: System Events, Accessibility permission.
    async frontmost() {
      const out = await run(execFileImpl, "osascript", ["-e", frontmostScript()], timeoutMs);
      const failure = failOr(out.error, out, "the frontmost app");
      if (failure) throw failure;
      const [app, title] = out.stdout.trim().split("\t");
      return { app: app || "Unknown", title: title || "" };
    },

    // UNVERIFIED: Screen Recording permission.
    async screenshot(filePath) {
      const out = await run(execFileImpl, "screencapture", ["-x", "-t", "jpg", filePath], timeoutMs);
      const failure = failOr(out.error, out, "screenshots");
      if (failure) throw failure;
      return { ok: true, path: filePath };
    },

    // UNVERIFIED: JXA System Events dump, Accessibility permission.
    async axSnapshot() {
      const out = await run(execFileImpl, "osascript", ["-l", "JavaScript", axScriptPath], timeoutMs);
      const failure = failOr(out.error, out, "reading the screen");
      if (failure) throw failure;
      try {
        const parsed = JSON.parse(out.stdout.trim() || "{}");
        if (!parsed || !Array.isArray(parsed.elements)) throw new Error("bad ax dump");
        return { elements: parsed.elements };
      } catch {
        throw new Error(permissionMessage("reading the screen"));
      }
    },

    // UNVERIFIED: JXA CoreGraphics mouse event, Accessibility permission.
    async click(x, y) {
      const out = await run(
        execFileImpl,
        "osascript",
        ["-l", "JavaScript", "-e", clickScript(x, y)],
        timeoutMs,
      );
      const failure = failOr(out.error, out, "clicking");
      if (failure) throw failure;
      return { ok: true };
    },

    // UNVERIFIED: System Events keystroke, Accessibility permission.
    async keys(combo) {
      const script = keysScript(combo);
      const out = await run(execFileImpl, "osascript", ["-e", script], timeoutMs);
      const failure = failOr(out.error, out, "pressing keys");
      if (failure) throw failure;
      return { ok: true };
    },

    // UNVERIFIED: System Events keystroke, Accessibility permission.
    async type(text) {
      const script = `tell application "System Events" to keystroke "${escapeAppleScript(text)}"`;
      const out = await run(execFileImpl, "osascript", ["-e", script], timeoutMs);
      const failure = failOr(out.error, out, "typing");
      if (failure) throw failure;
      return { ok: true };
    },

    // UNVERIFIED: plain `open -a`, no special permission beyond the app itself.
    async open(appName) {
      const out = await run(execFileImpl, "open", ["-a", appName], timeoutMs);
      const failure = failOr(out.error, out, `opening ${appName}`);
      if (failure) throw failure;
      return { ok: true };
    },
  };
}
