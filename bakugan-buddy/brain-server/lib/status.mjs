/**
 * Health of every piece Preyas runs, in one object the app can draw as dots.
 *
 * The probes are injected, so the shape and the ok/down rules are testable
 * without a live llama-server or a mounted drive.
 */
import fs from "node:fs";
import { execFile } from "node:child_process";

export const PARTS = ["llama", "proxy", "whisper", "gateway", "web", "drive"];

const PROBES = {
  llama: { url: "http://127.0.0.1:8790/health", label: "llama-server" },
  proxy: { url: "http://127.0.0.1:8788/v1/health", label: "brain proxy" },
  whisper: { url: "http://127.0.0.1:8178/health", label: "whisper" },
  gateway: { url: "http://127.0.0.1:4000/health/liveliness", label: "gateway" },
  web: { url: "http://127.0.0.1:8081", label: "web app" },
};

async function checkUrl(url, fetchImpl, timeoutMs = 2500) {
  try {
    const res = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs) });
    return res.ok || res.status === 404;
  } catch {
    return false;
  }
}

function diskFreeGb(root) {
  return new Promise((resolve) => {
    execFile("df", ["-k", root], { timeout: 4000 }, (error, stdout) => {
      if (error) return resolve(null);
      const line = String(stdout).trim().split("\n").pop() || "";
      const parts = line.split(/\s+/);
      const availableKb = Number(parts[3]);
      resolve(Number.isFinite(availableKb) ? Math.round((availableKb / 1024 / 1024) * 10) / 10 : null);
    });
  });
}

function swapMb() {
  return new Promise((resolve) => {
    execFile("sysctl", ["-n", "vm.swapusage"], { timeout: 4000 }, (error, stdout) => {
      if (error) return resolve(null);
      const match = String(stdout).match(/used = ([\d.]+)M/);
      resolve(match ? Number(match[1]) : null);
    });
  });
}

/**
 * Build the status object. `checks` overrides individual probes so tests can
 * pretend a part is up or down.
 */
export async function collectStatus(options = {}) {
  const {
    drive = "/Volumes/Agent",
    buddy = "/Volumes/Agent/BakuganBuddy",
    fetchImpl = fetch,
    checks = {},
    diskFree = () => diskFreeGb(drive),
    swap = () => swapMb(),
    now = () => new Date().toISOString(),
  } = options;

  const parts = {};
  for (const name of PARTS) {
    if (name === "drive") {
      const mounted = fs.existsSync(buddy);
      parts.drive = {
        ok: mounted,
        label: "Agent drive",
        detail: mounted ? buddy : "not mounted — plug in the Agent drive",
      };
      continue;
    }
    const spec = PROBES[name];
    const ok = name in checks ? Boolean(checks[name]) : await checkUrl(spec.url, fetchImpl);
    parts[name] = { ok, label: spec.label, detail: ok ? "running" : "down" };
  }

  const free = parts.drive.ok ? await diskFree() : null;
  const swapUsed = await swap();
  const healthy = PARTS.every((name) => parts[name].ok);

  return {
    ok: healthy,
    checkedAt: now(),
    drive: { mounted: parts.drive.ok, path: drive, freeGb: free },
    memory: { swapUsedMb: swapUsed },
    parts,
  };
}

/** "Restart Preyas" runs the launcher's down and up scripts, detached. */
export function restartArgs(launcherDir) {
  return [
    "-c",
    `"${launcherDir}/preyas-down.sh" >>/dev/null 2>&1; sleep 1; "${launcherDir}/preyas-up.sh" >>/dev/null 2>&1`,
  ];
}
