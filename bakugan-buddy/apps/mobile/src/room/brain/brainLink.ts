import AsyncStorage from "@react-native-async-storage/async-storage";

const KEY = "bakugan-buddy.brain.host";

export async function readBrainHost(): Promise<string> {
  try {
    return (await AsyncStorage.getItem(KEY)) || "";
  } catch {
    return "";
  }
}

export async function writeBrainHost(host: string): Promise<void> {
  try {
    const trimmed = host.trim().replace(/\/$/, "");
    if (!trimmed) {
      await AsyncStorage.removeItem(KEY);
      return;
    }
    await AsyncStorage.setItem(KEY, trimmed);
  } catch {
    /* the field still works for this session */
  }
}

export function normalizeBrainUrl(raw: string): string {
  const trimmed = raw.trim().replace(/\/$/, "");
  if (!trimmed) return "";
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) return trimmed;
  return `http://${trimmed}`;
}

/** True when the Mac proxy (or llama-server) answers. */
export async function probeBrain(url: string, timeoutMs = 700): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${normalizeBrainUrl(url)}/v1/health`, { signal: controller.signal });
    if (!res.ok) return false;
    const body = (await res.json()) as { service?: string; ok?: boolean; status?: string };
    return body.service === "bakugan-brain" || body.ok === true || body.status === "ok";
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Try the saved host, an env override, localhost, then a short slice of the
 * phone's /24. Expo Go can do this with fetch. A full mDNS browse needs a
 * dev client; the Mac still advertises `_bakugan-brain._tcp`.
 */
export async function findBrain(options: {
  saved?: string;
  envUrl?: string;
  localIp?: string | null;
}): Promise<string | null> {
  const first = [
    options.saved || "",
    options.envUrl || "",
    "http://127.0.0.1:8788",
    "http://127.0.0.1:4000",
  ];
  for (let i = 0; i < first.length; i++) {
    const url = normalizeBrainUrl(first[i] || "");
    if (!url) continue;
    if (await probeBrain(url)) return url;
  }
  const ip = options.localIp || "";
  const match = ip.match(/^(\d+\.\d+\.\d+)\.(\d+)$/);
  if (!match) return null;
  const prefix = match[1];
  const own = Number(match[2]);
  const hosts: number[] = [];
  for (let n = 1; n <= 30; n++) hosts.push(n);
  for (let n = 100; n <= 130; n++) hosts.push(n);
  const pending: Promise<string | null>[] = [];
  for (let i = 0; i < hosts.length; i++) {
    const host = hosts[i]!;
    if (host === own) continue;
    const url = `http://${prefix}.${host}:8788`;
    const gateway = `http://${prefix}.${host}:4000`;
    pending.push(probeBrain(url, 450).then((ok) => (ok ? url : null)));
    pending.push(probeBrain(gateway, 450).then((ok) => (ok ? gateway : null)));
    if (pending.length >= 12) {
      const hit = (await Promise.all(pending)).find((item) => item);
      if (hit) return hit;
      pending.length = 0;
    }
  }
  const hit = (await Promise.all(pending)).find((item) => item);
  return hit || null;
}

/** Relevant long-term facts. A slow or missing brain just means none. */
export async function fetchRemembered(url: string, query: string, timeoutMs = 700): Promise<string[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${normalizeBrainUrl(url)}/v1/facts?q=${encodeURIComponent(query)}`, {
      signal: controller.signal,
    });
    if (!res.ok) return [];
    const body = (await res.json()) as { facts?: unknown };
    if (!Array.isArray(body.facts)) return [];
    return body.facts.filter((fact): fact is string => typeof fact === "string").slice(0, 4);
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

export function sendMoment(url: string, body: string): void {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 800);
  void fetch(`${normalizeBrainUrl(url)}/v1/facts`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
    signal: controller.signal,
  })
    .catch(() => {})
    .finally(() => clearTimeout(timer));
}
