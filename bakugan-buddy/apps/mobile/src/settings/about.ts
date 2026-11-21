/**
 * Pure helpers for Settings > About Preyas. The brain sends the capability
 * snapshot and changelog; this file keeps the shape forgiving and the labels
 * short enough for a phone card.
 */

export type CapabilityItem = {
  id: string;
  label: string;
  detail: string;
  available?: boolean;
  current?: boolean;
};

export type CapabilityService = {
  id: string;
  label: string;
  running: boolean;
  port?: number;
};

export type CapabilitiesView = {
  builtAt: string;
  currentModel: string;
  tools: CapabilityItem[];
  models: CapabilityItem[];
  media: CapabilityItem[];
  services: CapabilityService[];
  changelog: { date: string; text: string }[];
  summary: string;
};

export const ABOUT_GROUPS: { key: "tools" | "models" | "media"; title: string }[] = [
  { key: "tools", title: "Things I can do" },
  { key: "models", title: "Brains I can think with" },
  { key: "media", title: "Sounds and pictures" },
];

export const ABOUT_CHANGELOG_LIMIT = 5;

function itemFrom(raw: unknown): CapabilityItem | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  const label = typeof row.label === "string" ? row.label.trim() : "";
  if (!label) return null;
  return {
    id: typeof row.id === "string" ? row.id : label,
    label: label.slice(0, 60),
    detail: typeof row.detail === "string" ? row.detail.slice(0, 100) : "",
    available: row.available !== false,
    current: row.current === true,
  };
}

function serviceFrom(raw: unknown): CapabilityService | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  const label = typeof row.label === "string" ? row.label.trim() : typeof row.id === "string" ? row.id.trim() : "";
  if (!label) return null;
  const port = Number(row.port);
  return {
    id: typeof row.id === "string" ? row.id : label,
    label: label.slice(0, 60),
    running: row.running === true,
    port: Number.isFinite(port) ? port : undefined,
  };
}

/** Tolerates an older brain that has no capabilities route yet. */
export function normalizeCapabilities(raw: unknown): CapabilitiesView {
  const body = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const items = (value: unknown): CapabilityItem[] =>
    Array.isArray(value) ? value.map(itemFrom).filter((row): row is CapabilityItem => Boolean(row)) : [];
  const changelog = Array.isArray(body.changelog)
    ? body.changelog
        .filter((row): row is Record<string, unknown> => Boolean(row) && typeof row === "object")
        .map((row) => ({ date: String(row.date ?? "").slice(0, 10), text: String(row.text ?? "").slice(0, 160) }))
        .filter((row) => /^I can now/.test(row.text))
    : [];
  const services = Array.isArray(body.services)
    ? body.services.map(serviceFrom).filter((row): row is CapabilityService => Boolean(row))
    : [];
  return {
    builtAt: typeof body.builtAt === "string" ? body.builtAt : "",
    currentModel: typeof body.currentModel === "string" ? body.currentModel : "",
    tools: items(body.tools),
    models: items(body.models),
    media: items(body.media),
    services,
    changelog,
    summary: typeof body.summary === "string" ? body.summary : "",
  };
}

export function aboutItems(view: CapabilitiesView, key: "tools" | "models" | "media"): CapabilityItem[] {
  return view[key].filter((item) => item.available !== false);
}

export function changelogPreview(view: CapabilitiesView, limit = ABOUT_CHANGELOG_LIMIT): { date: string; text: string }[] {
  return view.changelog.slice(0, Math.max(0, limit));
}

export function serviceDots(view: CapabilitiesView): { label: string; running: boolean }[] {
  return view.services.map((service) => ({ label: service.label, running: service.running }));
}

export function hasAnything(view: CapabilitiesView): boolean {
  return (
    aboutItems(view, "tools").length > 0 ||
    aboutItems(view, "models").length > 0 ||
    aboutItems(view, "media").length > 0 ||
    view.services.length > 0
  );
}

export function aboutHeadline(view: CapabilitiesView): string {
  if (!hasAnything(view)) return "The Mac has not told me what I can do yet.";
  const tools = aboutItems(view, "tools").length;
  const models = aboutItems(view, "models").length;
  return (
    tools + " " + (tools === 1 ? "tool" : "tools") +
    " · " + models + " " + (models === 1 ? "brain" : "brains") +
    " · " + changelogPreview(view).length + " recent notes"
  );
}
