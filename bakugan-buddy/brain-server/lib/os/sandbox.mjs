/**
 * Execution confinement for the terminal tool.
 *
 * On macOS every command runs through sandbox-exec with a profile built from
 * the allowed roots: reads and writes are limited to those roots (real paths,
 * so a symlink cannot widen them), the system folders stay readable so
 * binaries run, everything else (home, /etc, other drives) is denied by
 * default, and the network is off. On other platforms (the Linux CI, where
 * the product does not run) the command runs with the existing checks only.
 */
import fs from "node:fs";
import path from "node:path";

/** Escapes a path for a sandbox profile string. */
function profilePath(text) {
  return String(text).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

/** The real path of one root (symlinks resolved); falls back to resolve(). */
function realRoot(root) {
  try {
    return fs.realpathSync(root);
  } catch {
    return path.resolve(root);
  }
}

/**
 * The sandbox profile for the allowed roots. Reads and writes are allowed
 * only under the roots (plus the system folders needed to run binaries and
 * /dev literals); everything else is denied by default and the network is
 * off. `extraRead` lets a caller (tests) add one more readable folder.
 */
export function sandboxProfile(roots, { extraRead = [] } = {}) {
  const readRoots = [...roots, ...extraRead]
    .map((root) => realRoot(root))
    .filter((root, index, all) => all.indexOf(root) === index);
  const writeRoots = roots.map((root) => realRoot(root)).filter((root, index, all) => all.indexOf(root) === index);
  const lines = [
    "(version 1)",
    "(deny default)",
    '(import "system.sb")',
    "(allow process*)",
    ...readRoots.map((root) => `(allow file-read* (subpath "${profilePath(root)}"))`),
    ...writeRoots.map((root) => `(allow file-write* (subpath "${profilePath(root)}"))`),
    '(allow file-read* (subpath "/bin") (subpath "/sbin") (subpath "/usr") (subpath "/System") (subpath "/Library"))',
    '(allow file-read* (literal "/dev/null") (literal "/dev/zero") (literal "/dev/urandom") (literal "/dev/random"))',
    '(allow file-write* (literal "/dev/null") (literal "/dev/zero"))',
    "(deny network*)",
  ];
  return lines.join("\n");
}

/**
 * Wrap one shell command in the confinement runner. On macOS: sandbox-exec
 * with the profile above; elsewhere: the plain shell (existing behaviour).
 */
export function confineCommand(command, { roots = [], extraRead = [], platform = process.platform } = {}) {
  const safeRoots = roots.length ? roots : [process.cwd()];
  if (platform === "darwin") {
    return {
      command: "/usr/bin/sandbox-exec",
      args: ["-p", sandboxProfile(safeRoots, { extraRead }), "/bin/zsh", "-c", command],
    };
  }
  return { command: "/bin/sh", args: ["-c", command] };
}
