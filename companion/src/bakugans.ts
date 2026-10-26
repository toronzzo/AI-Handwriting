export type Attribute = "pyrus" | "aquos" | "darkus";
export type Emotion =
  | "idle"
  | "listening"
  | "thinking"
  | "happy"
  | "excited"
  | "calm"
  | "sad"
  | "curious"
  | "fierce"
  | "mysterious"
  | "amused";

export type BakuganId = "preyas" | "pyrax" | "vexar";

export type BakuganProfile = {
  id: BakuganId;
  name: string;
  attribute: Attribute;
  tagline: string;
  personality: string;
  voice: { pitch: number; rate: number };
  colors: {
    shell: string;
    shellDeep: string;
    accent: string;
    accentHot: string;
    core: string;
    eye: string;
    claw: string;
    ash: string;
  };
  aliases: string[];
};

/** Preyas-first roster. Same ball language; attribute paints the shell. */
export const BAKUGANS: Record<BakuganId, BakuganProfile> = {
  preyas: {
    id: "preyas",
    name: "Preyas",
    attribute: "aquos",
    tagline: "Aquos ball. Voice + body do the talkin'.",
    personality: "cheeky, warm, bounce-happy, Southern-flavored charm",
    voice: { pitch: 1.18, rate: 1.08 },
    colors: {
      shell: "#c8c8c8",
      shellDeep: "#2a2a2a",
      accent: "#f2f2f2",
      accentHot: "#ffffff",
      core: "#e0e0e0",
      eye: "#ffffff",
      claw: "#9a9a9a",
      ash: "#e8e8e8",
    },
    aliases: ["preyas", "aquos", "water", "blue"],
  },
  pyrax: {
    id: "pyrax",
    name: "Pyrax",
    attribute: "pyrus",
    tagline: "Pyrus shell. Same bounce language, hotter core.",
    personality: "fiery, bold, protective, a little cocky",
    voice: { pitch: 0.88, rate: 1.06 },
    colors: {
      shell: "#ececec",
      shellDeep: "#3a3a3a",
      accent: "#ffffff",
      accentHot: "#fafafa",
      core: "#d4d4d4",
      eye: "#f5f5f5",
      claw: "#b0b0b0",
      ash: "#eeeeee",
    },
    aliases: ["pyrax", "pyrus", "fire", "ember"],
  },
  vexar: {
    id: "vexar",
    name: "Vexar",
    attribute: "darkus",
    tagline: "Darkus shell. Quiet bounce. Sharp eye.",
    personality: "mysterious, dry-witted, loyal, soft-spoken",
    voice: { pitch: 0.72, rate: 0.9 },
    colors: {
      shell: "#6e6e6e",
      shellDeep: "#141414",
      accent: "#d0d0d0",
      accentHot: "#ececec",
      core: "#a8a8a8",
      eye: "#e6e6e6",
      claw: "#888888",
      ash: "#dcdcdc",
    },
    aliases: ["vexar", "darkus", "shadow", "void"],
  },
};

export const BAKUGAN_LIST = Object.values(BAKUGANS);

export function findBakuganByUtterance(text: string): BakuganId | null {
  const lower = text.toLowerCase().trim();
  for (const b of BAKUGAN_LIST) {
    if (new RegExp(`\\b${b.name.toLowerCase()}\\b`, "i").test(lower)) return b.id;
  }
  for (const b of BAKUGAN_LIST) {
    for (const a of b.aliases) {
      if (a === b.name.toLowerCase()) continue;
      if (
        (/\b(switch|talk to|wake|summon|hey|call|hi)\b/.test(lower) || lower === a) &&
        new RegExp(`\\b${a}\\b`, "i").test(lower)
      ) {
        return b.id;
      }
    }
  }
  return null;
}

export const EMOTION_TAGS: Emotion[] = [
  "idle",
  "listening",
  "thinking",
  "happy",
  "excited",
  "calm",
  "sad",
  "curious",
  "fierce",
  "mysterious",
  "amused",
];

export function parseEmotionPrefix(raw: string): {
  emotion: Emotion;
  text: string;
} {
  const m = raw.trim().match(/^\[([a-z]+)\]\s*([\s\S]*)$/i);
  if (!m) return { emotion: "idle", text: raw.trim() };
  const tag = m[1]!.toLowerCase() as Emotion;
  if (EMOTION_TAGS.includes(tag)) {
    return { emotion: tag === "idle" ? "calm" : tag, text: m[2]!.trim() };
  }
  return { emotion: "curious", text: m[2]!.trim() };
}

export function splitSentences(text: string): string[] {
  const cleaned = text.replace(/\*[^*]+\*/g, " ").replace(/\s+/g, " ").trim();
  if (!cleaned) return [];
  const parts = cleaned.match(/[^.!?]+[.!?]+|[^.!?]+$/g);
  return (parts ?? [cleaned]).map((s) => s.trim()).filter(Boolean);
}
