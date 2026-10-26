import type { BakuganId } from "./bakugans";
import type { Form } from "./types";

export type PartnerMemory = {
  partnerName: string | null;
  facts: string[];
  activeId: BakuganId;
  forms: Record<BakuganId, Form>;
  bonds: Record<BakuganId, number>;
};

const KEY = "bakugan-live-v2";

const defaultBonds = (): Record<BakuganId, number> => ({
  pyrax: 8,
  namiq: 8,
  vexar: 8,
});

const defaultForms = (): Record<BakuganId, Form> => ({
  pyrax: "sphere",
  namiq: "sphere",
  vexar: "sphere",
});

export function defaultMemory(): PartnerMemory {
  return {
    partnerName: null,
    facts: [],
    activeId: "pyrax",
    forms: defaultForms(),
    bonds: defaultBonds(),
  };
}

export function loadMemory(): PartnerMemory {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) {
      // migrate v1 pyrax bond if present
      const legacy = localStorage.getItem("pyrax-companion-v1");
      if (legacy) {
        const p = JSON.parse(legacy) as {
          partnerName?: string | null;
          facts?: string[];
          bond?: number;
          form?: Form;
        };
        const mem = defaultMemory();
        mem.partnerName = p.partnerName ?? null;
        mem.facts = Array.isArray(p.facts) ? p.facts.slice(-40) : [];
        if (typeof p.bond === "number") mem.bonds.pyrax = p.bond;
        if (p.form === "battle" || p.form === "sphere") mem.forms.pyrax = p.form;
        return mem;
      }
      return defaultMemory();
    }
    const parsed = JSON.parse(raw) as Partial<PartnerMemory>;
    return {
      partnerName: parsed.partnerName ?? null,
      facts: Array.isArray(parsed.facts) ? parsed.facts.slice(-40) : [],
      activeId:
        parsed.activeId === "namiq" || parsed.activeId === "vexar"
          ? parsed.activeId
          : "pyrax",
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
