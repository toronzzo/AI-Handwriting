/**
 * B6 computer control: the adapter interface between the brain and the Mac.
 * The brain never calls the OS directly: it talks to this interface, so
 * every test can inject the fake and no real Mac call happens in CI.
 *
 * Interface (all methods async):
 *   frontmost()              -> { app, title, url? }
 *   screenshot(filePath)     -> { ok, path } | throws with a plain message
 *   axSnapshot()             -> { elements: [{ id, role, label, x, y, w, h }] }
 *   click(x, y)              -> { ok, ... }
 *   keys(combo)              -> { ok, ... }
 *   type(text)               -> { ok, ... }
 *   open(appName)            -> { ok, ... }
 *
 * The snapshot has at most 80 elements and labels are cut to 60 characters.
 */

export const AX_SNAPSHOT_MAX = 80;
export const AX_LABEL_MAX = 60;

/** A test-only adapter: canned answers plus a record of every call. */
export function createFakeAdapter(script = {}) {
  const calls = [];
  const record = (name, args) => {
    calls.push([name, ...args]);
  };

  return {
    calls,
    async frontmost() {
      record("frontmost", []);
      const value = typeof script.frontmost === "function" ? script.frontmost() : script.frontmost;
      return value ?? { app: "FakeApp", title: "Fake Window" };
    },
    async screenshot(filePath) {
      record("screenshot", [filePath]);
      if (typeof script.screenshot === "function") return await script.screenshot(filePath);
      return { ok: true, path: filePath };
    },
    async axSnapshot() {
      record("axSnapshot", []);
      if (typeof script.axSnapshot === "function") return await script.axSnapshot();
      return { elements: [] };
    },
    async click(x, y) {
      record("click", [x, y]);
      if (typeof script.click === "function") return await script.click(x, y);
      return { ok: true };
    },
    async keys(combo) {
      record("keys", [combo]);
      if (typeof script.keys === "function") return await script.keys(combo);
      return { ok: true };
    },
    async type(text) {
      record("type", [text]);
      if (typeof script.type === "function") return await script.type(text);
      return { ok: true };
    },
    async open(appName) {
      record("open", [appName]);
      if (typeof script.open === "function") return await script.open(appName);
      return { ok: true };
    },
  };
}

/** Caps an accessibility snapshot so no huge window ever floods the model. */
export function capSnapshot(elements) {
  const rows = Array.isArray(elements) ? elements : [];
  return {
    elements: rows.slice(0, AX_SNAPSHOT_MAX).map((row) => ({
      id: String(row?.id ?? "").slice(0, 40),
      role: String(row?.role ?? "").slice(0, 30),
      label: String(row?.label ?? "").slice(0, AX_LABEL_MAX),
      x: Number(row?.x) || 0,
      y: Number(row?.y) || 0,
      w: Number(row?.w) || 0,
      h: Number(row?.h) || 0,
    })),
  };
}
