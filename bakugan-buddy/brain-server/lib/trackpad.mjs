/**
 * Trackpad voice: the Mac's haptic motor as a small speaker.
 *
 * Preyas' voice normally leaves through the Mac's speakers as a Piper WAV. When
 * nospeaker (github.com/os6/nospeaker) is installed, the same line also goes to
 * the Force Touch trackpad's motor, which moves the glass up to 4,000 times a
 * second so the glass itself is what you hear. Mute the Mac and it still talks.
 *
 * Three rules the rest of the brain relies on:
 *   - it is a nicety: a Mac without a Force Touch trackpad, or a Mac without the
 *     nospeaker binary, is "available: false" — never an error on the voice path;
 *   - one line at a time: a new line stops the one still playing, so Preyas never
 *     talks over itself;
 *   - the switch lives on the drive (memory/trackpad.json), so the Mac and the
 *     phone agree, and it survives a restart.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/** Where the one-line installer (a90.com/nospeaker) puts the program. */
export const TRACKPAD_BIN = path.join(os.homedir(), ".local", "bin", "nospeaker");

/** One short line of speech; past this the motor is still going when the next line arrives. */
export const MAX_CHARS = 400;

/**
 * The nospeaker program: TRACKPAD_BIN wins when it exists, then the installer's
 * ~/.local/bin/nospeaker. "" when this Mac has neither.
 */
export function trackpadBinFor(env = process.env, exists = (file) => fs.existsSync(file)) {
  const set = String(env.TRACKPAD_BIN || "").trim();
  if (set && exists(set)) return set;
  return exists(TRACKPAD_BIN) ? TRACKPAD_BIN : "";
}

/** Only a Mac has a trackpad, and only with the program can it be driven. */
export function trackpadAvailableFor(env = process.env, options = {}) {
  const exists = options.exists || ((file) => fs.existsSync(file));
  const platform = options.platform || process.platform;
  if (platform !== "darwin") return false;
  return trackpadBinFor(env, exists) !== "";
}

/**
 * One clean line for the motor: whitespace flattened (a newline would split the
 * argument), a leading dash dropped (nospeaker would read it as a flag), and
 * never longer than MAX_CHARS. Empty text is empty: there is nothing to say.
 */
export function trackpadText(text) {
  const flat = String(text ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[-–—]+/, "")
    .trim();
  return flat.slice(0, MAX_CHARS).trim();
}

export function trackpadSettingsPath(root) {
  return path.join(root, "memory", "trackpad.json");
}

/** The switch: ON unless the user turned it off. An unreadable file cannot silence Preyas. */
export function readTrackpadEnabled(root, exists = (file) => fs.existsSync(file)) {
  try {
    const file = trackpadSettingsPath(root);
    if (!exists(file)) return true;
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    return !parsed || parsed.enabled !== false;
  } catch {
    return true;
  }
}

/** Saved as one small file on the drive, written whole and renamed, like the other settings. */
export function writeTrackpadEnabled(root, enabled) {
  try {
    const file = trackpadSettingsPath(root);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const temp = `${file}.tmp`;
    fs.writeFileSync(temp, `${JSON.stringify({ enabled: enabled !== false })}\n`);
    fs.renameSync(temp, file);
    return true;
  } catch {
    return false;
  }
}

/**
 * One speaker for the motor. \`say\` never throws and never queues: it stops the
 * line still playing and starts the new one, which is what a voice should do.
 */
export function createTrackpad(options = {}) {
  const env = options.env || process.env;
  const spawnImpl = options.spawn || spawn;
  const platform = options.platform || process.platform;
  const root = options.dataDir || "";
  const bin = options.bin !== undefined ? options.bin : trackpadBinFor(env, options.exists);
  const available = Boolean(bin) && platform === "darwin";
  let enabled =
    options.enabled !== undefined ? options.enabled !== false : root ? readTrackpadEnabled(root) : true;
  let current = null;
  let speaking = false;

  function state() {
    return { available, enabled, speaking };
  }

  function stop() {
    if (!current) return false;
    const child = current;
    current = null;
    speaking = false;
    try {
      child.kill("SIGTERM");
    } catch {
      /* already gone */
    }
    return true;
  }

  function setEnabled(on) {
    enabled = on !== false;
    if (!enabled) stop();
    if (root) writeTrackpadEnabled(root, enabled);
    return enabled;
  }

  function say(text) {
    const line = trackpadText(text);
    if (!line || !available || !enabled) return false;
    stop();
    let child;
    try {
      child = spawnImpl(bin, [line], { stdio: "ignore" });
    } catch {
      return false;
    }
    if (!child) return false;
    current = child;
    speaking = true;
    const done = () => {
      if (current === child) {
        current = null;
        speaking = false;
      }
    };
    if (typeof child.on === "function") {
      child.on("exit", done);
      child.on("error", done);
    }
    return true;
  }

  return { state, say, stop, setEnabled };
}
