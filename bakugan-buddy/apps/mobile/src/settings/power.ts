/**
 * Pure helpers for Settings > Power. Kept out of the component so the shapes,
 * dots, RAM labels and the honest "off" copy are testable with plain Node.
 */

export type PowerService = {
  name: string;
  label: string;
  port: number;
  running: boolean;
  health?: boolean;
  pid?: number | null;
  ramMb?: number;
  available?: boolean;
  detail?: string;
};

export type PowerAutostart = {
  installed: boolean;
  supported: boolean;
  path?: string;
};

export type PowerStatus = {
  ok: boolean;
  checkedAt?: string;
  services: PowerService[];
  autostart: PowerAutostart;
  error?: string;
};

export const POWER_SERVICE_ORDER = ["llama", "litellm", "kiwix", "brain", "web"];

export const POWER_SERVICE_LABELS: Record<string, string> = {
  llama: "Model",
  litellm: "Paid fallback",
  kiwix: "Offline library",
  brain: "Brain",
  web: "Web app",
};

export const TURN_OFF_CONFIRM = {
  title: "Turn off everything?",
  body:
    "This stops the model, the brain, offline search and the web app, and frees their RAM. " +
    "To turn Preyas back on, double-click Preyas ON on the Desktop.",
  confirm: "Turn off",
  no: "Keep on",
};

export const CANNOT_TURN_ON_NOTE =
  "The app cannot turn itself back on. Double-click Preyas ON on the Desktop.";

export const AUTOSTART_NOTE = "Off by default. When on, Preyas starts when you log in to the Mac.";

function finiteNumber(value: unknown): number | null {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function serviceFrom(raw: unknown): PowerService | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  const name = String(row.name ?? "").trim();
  if (!name) return null;
  return {
    name,
    label: String(row.label ?? POWER_SERVICE_LABELS[name] ?? name).slice(0, 40),
    port: finiteNumber(row.port) ?? 0,
    running: row.running === true,
    health: row.health === true,
    pid: finiteNumber(row.pid),
    ramMb: Math.max(0, Math.round(finiteNumber(row.ramMb) ?? 0)),
    available: row.available !== false,
    detail: typeof row.detail === "string" ? row.detail.slice(0, 80) : "",
  };
}

/** Never trust the wire shape: the panel should still draw a useful card. */
export function normalizePowerStatus(raw: unknown): PowerStatus {
  const body = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const services = Array.isArray(body.services)
    ? body.services.map(serviceFrom).filter((row): row is PowerService => Boolean(row))
    : [];
  services.sort((left, right) => {
    const a = POWER_SERVICE_ORDER.indexOf(left.name);
    const b = POWER_SERVICE_ORDER.indexOf(right.name);
    return (a < 0 ? 99 : a) - (b < 0 ? 99 : b);
  });
  const autostartRaw = body.autostart && typeof body.autostart === "object" ? (body.autostart as Record<string, unknown>) : {};
  return {
    ok: body.ok !== false && services.some((row) => row.running),
    checkedAt: typeof body.checkedAt === "string" ? body.checkedAt : "",
    services,
    autostart: {
      installed: autostartRaw.installed === true,
      supported: autostartRaw.supported === true,
      path: typeof autostartRaw.path === "string" ? autostartRaw.path : "",
    },
    error: typeof body.error === "string" ? body.error : "",
  };
}

/** on: running and answering; warn: a process exists but the health check failed. */
export function powerDot(service: PowerService): "on" | "warn" | "off" {
  if (!service.running) return "off";
  if (service.health === false) return "warn";
  return "on";
}

export function ramLabel(mb: number | undefined | null): string {
  const value = Math.max(0, Math.round(Number(mb) || 0));
  if (value >= 1024) return (value / 1024).toFixed(1) + " GB";
  return value + " MB";
}

/** One short line for a service row: state, port and RAM. */
export function serviceLine(service: PowerService): string {
  const port = service.port > 0 ? ":" + service.port : "";
  if (!service.running) {
    return service.available === false ? "not set up" + (service.detail ? " · " + service.detail : "") : "stopped" + (port ? " · " + port : "");
  }
  const health = service.health === false ? " · not answering" : "";
  return "running" + (port ? " · " + port : "") + " · " + ramLabel(service.ramMb) + health;
}

export function runningCount(status: PowerStatus | null): number {
  return status ? status.services.filter((service) => service.running).length : 0;
}

export function powerSummary(status: PowerStatus | null): string {
  if (!status || !status.services.length) return "Checking the Mac…";
  const count = runningCount(status);
  if (count === 0) return "Preyas is off.";
  if (count === status.services.length) return "All " + count + " services are running.";
  return count + " of " + status.services.length + " services are running.";
}

export function canRestartBrain(status: PowerStatus | null): boolean {
  return Boolean(status?.services.some((service) => service.name === "brain"));
}

export function canTurnOff(status: PowerStatus | null): boolean {
  return runningCount(status) > 0;
}

/** A timeout and an unreachable Mac are different things to a person. */
export function powerErrorMessage(error: unknown): string {
  const name = error && typeof error === "object" && "name" in error ? String((error as { name?: string }).name) : "";
  if (name === "TimeoutError" || name === "AbortError") return "The Mac is taking too long. Is Preyas still starting?";
  return "The Mac did not answer. Is Preyas running?";
}
