import type { BakuganId } from "./bakugans";
import type { Form } from "./types";

export type PartnerMemory = {
  partnerName: string | null;
  facts: string[];
  activeId: BakuganId;
  forms: Record<BakuganId, Form>;
  bonds: Record<BakuganId, number>;
};

const KEY = "bakugan-live-v3";

const defaultBonds = (): Record<BakuganId, number> => ({
  preyas: 8,
  pyrax: 8,
  vexar: 8,
});

const defaultForms = (): Record<BakuganId, Form> => ({
  preyas: "sphere",
  pyrax: "sphere",
  vexar: "sphere",
});

export function defaultMemory(): PartnerMemory {
  return {
    partnerName: null,
    facts: [],
    activeId: "preyas",
    forms: defaultForms(),
    bonds: defaultBonds(),
  };
}

const INVALID_NAMES = new Set([
  "sad",
  "happy",
  "angry",
  "mad",
  "scared",
  "tired",
  "lonely",
  "fine",
  "good",
  "okay",
  "ok",
  "excited",
]);

function cleanName(name: string | null | undefined): string | null {
  if (!name) return null;
  if (INVALID_NAMES.has(name.toLowerCase())) return null;
  return name;
}

export function loadMemory(): PartnerMemory {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) {
      // migrate older keys
      for (const legacyKey of ["bakugan-live-v2", "pyrax-companion-v1"]) {
        const legacy = localStorage.getItem(legacyKey);
        if (!legacy) continue;
        const p = JSON.parse(legacy) as {
          partnerName?: string | null;
          facts?: string[];
          bond?: number;
          bonds?: Partial<Record<string, number>>;
          form?: Form;
          forms?: Partial<Record<string, Form>>;
          activeId?: string;
        };
        const mem = defaultMemory();
        mem.partnerName = cleanName(p.partnerName);
        mem.facts = Array.isArray(p.facts) ? p.facts.slice(-40) : [];
        if (p.activeId === "pyrax" || p.activeId === "vexar" || p.activeId === "preyas") {
          mem.activeId = p.activeId;
        } else if (p.activeId === "namiq") {
          mem.activeId = "preyas";
        }
        if (typeof p.bond === "number") mem.bonds.preyas = p.bond;
        if (p.bonds) {
          for (const [k, v] of Object.entries(p.bonds)) {
            if (k === "namiq" && typeof v === "number") mem.bonds.preyas = v;
            if ((k === "preyas" || k === "pyrax" || k === "vexar") && typeof v === "number") {
              mem.bonds[k] = v;
            }
          }
        }
        if (p.form === "battle" || p.form === "sphere") mem.forms.preyas = p.form;
        return mem;
      }
      return defaultMemory();
    }
    const parsed = JSON.parse(raw) as Partial<PartnerMemory>;
    return {
      partnerName: cleanName(parsed.partnerName),
      facts: Array.isArray(parsed.facts) ? parsed.facts.slice(-40) : [],
      activeId:
        parsed.activeId === "pyrax" || parsed.activeId === "vexar"
          ? parsed.activeId
          : "preyas",
      forms: { ...defaultForms(), ...(parsed.forms ?? {}) },
      bonds: { ...defaultBonds(), ...(parsed.bonds ?? {}) },
    };
  } catch {
    return defaultMemory();
  }
}

export function saveMemory(mem: PartnerMemory) {
  localStorage.setItem(KEY, JSON.stringify(mem));
}
