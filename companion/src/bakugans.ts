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
      shell: "#1a4fd6",
      shellDeep: "#0b2a8c",
      accent: "#5dfff0",
      accentHot: "#9ffff6",
      core: "#3de8ff",
      eye: "#ff2a2a",
      claw: "#7b5cff",
      ash: "#d8f3ff",
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
      shell: "#e03a12",
      shellDeep: "#7a1408",
      accent: "#ffb347",
      accentHot: "#ffe08a",
      core: "#ff6b1a",
      eye: "#ffef5a",
      claw: "#ff8a3d",
      ash: "#e8d5c4",
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
      shell: "#5b2d8e",
      shellDeep: "#240046",
      accent: "#c77dff",
      accentHot: "#e0aaff",
      core: "#b5179e",
      eye: "#ff4d6d",
      claw: "#9b5de5",
      ash: "#e0d4f7",
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

function normalizeEmotionTag(tag: string): Emotion {
  const lower = tag.toLowerCase();
  if (lower === "angry") return "fierce";
  if (lower === "idle") return "calm";
  return EMOTION_TAGS.includes(lower as Emotion) ? (lower as Emotion) : "curious";
}

/** Incremental `[mood] text` parser — complete only once the closing `]` arrives. */
export function parseEmotionPrefix(raw: string): {
  emotion: Emotion;
  text: string;
  complete: boolean;
} {
  const s = raw.trimStart();
  if (!s) {
    return { emotion: "thinking", text: "", complete: false };
  }
  if (s.startsWith("[")) {
    const close = s.indexOf("]");
    if (close === -1) {
      return { emotion: "thinking", text: "", complete: false };
    }
    const tag = s.slice(1, close);
    if (!/^[a-z]+$/i.test(tag)) {
      return { emotion: "curious", text: s.trim(), complete: true };
    }
    return {
      emotion: normalizeEmotionTag(tag),
      text: s.slice(close + 1).trim(),
      complete: true,
    };
  }
  return { emotion: "curious", text: s.trim(), complete: true };
}

export function splitSentences(text: string): string[] {
  const cleaned = text.replace(/\*[^*]+\*/g, " ").replace(/\s+/g, " ").trim();
  if (!cleaned) return [];
  const parts = cleaned.match(/[^.!?]+[.!?]+|[^.!?]+$/g);
  return (parts ?? [cleaned]).map((s) => s.trim()).filter(Boolean);
}
