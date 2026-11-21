import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { confineCommand, sandboxProfile } from "./sandbox.mjs";
import { runCommand } from "./terminalServer.mjs";

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "preyas-sandbox-"));
}

test("the profile allows the roots, denies everything else and the network", () => {
  const root = tempDir();
  try {
    const real = fs.realpathSync(root);
    const profile = sandboxProfile([root]);
    assert.match(profile, /\(deny default\)/);
    assert.match(profile, /\(deny network\*\)/);
    assert.ok(profile.includes(real), "the root enters the profile as its real path");
    assert.ok(profile.includes(`(allow file-read* (subpath "${real}"))`));
    assert.ok(profile.includes(`(allow file-write* (subpath "${real}"))`));
    assert.doesNotMatch(profile, /subpath "\/etc"/, "no system-wide escape hatch");
    assert.doesNotMatch(profile, /subpath "\/Users"/);
    // Quoted paths cannot break out of the profile.
    const evil = path.join(root, 'we"ird');
    const withQuote = sandboxProfile([evil]);
    assert.match(withQuote, /we\\"ird/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("confineCommand: sandbox-exec on darwin, plain shell elsewhere", () => {
  const root = tempDir();
  try {
    const darwin = confineCommand("echo hi", { roots: [root], platform: "darwin" });
    assert.equal(darwin.command, "/usr/bin/sandbox-exec");
    assert.equal(darwin.args[0], "-p");
    assert.match(darwin.args[1], /\(deny default\)/);
    assert.equal(darwin.args[2], "/bin/zsh");
    assert.equal(darwin.args[3], "-c");
    assert.equal(darwin.args[4], "echo hi");

    const linux = confineCommand("echo hi", { roots: [root], platform: "linux" });
    assert.equal(linux.command, "/bin/sh");
    assert.deepEqual(linux.args, ["-c", "echo hi"]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("darwin: a real sandbox blocks /etc, home and network, allows the roots", { skip: process.platform !== "darwin" }, async () => {
  const root = tempDir();
  try {
    fs.writeFileSync(path.join(root, "inside.txt"), "inside");
    const run = (command) => runCommand(command, { allowedRoots: [root], cwd: root });

    const inside = await run("cat inside.txt");
    assert.equal(inside.ok, true, inside.stderr);
    assert.match(inside.stdout, /inside/);

    const outsideRead = await run("cat /etc/hosts");
    assert.equal(outsideRead.ok, false, "reading outside the roots must fail");
    assert.match(outsideRead.stderr, /permitted|denied/i);

    const home = await run("cat $HOME/.zshrc");
    assert.equal(home.ok, false, "the home folder must stay unreadable");

    const outsideWrite = await run("echo x > /tmp/preyas-sandbox-escape.txt");
    assert.equal(outsideWrite.ok, false, "writing outside the roots must fail");

    const network = await run("curl -s -m 2 https://example.com/ -o /dev/null");
    assert.equal(network.ok, false, "the network must be off");

    // A symlink inside the root pointing outside stays blocked by the OS.
    fs.symlinkSync("/etc", path.join(root, "etc-link"));
    const viaLink = await run("cat etc-link/hosts");
    assert.equal(viaLink.ok, false, "a symlink cannot widen the sandbox");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
