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

export type BakuganId = "pyrax" | "namiq" | "vexar";

export type BakuganProfile = {
  id: BakuganId;
  name: string;
  attribute: Attribute;
  tagline: string;
  personality: string;
  /** SpeechSynthesis pitch / rate */
  voice: { pitch: number; rate: number };
  colors: {
    primary: string;
    secondary: string;
    glow: string;
    deep: string;
    ash: string;
  };
  aliases: string[];
};

export const BAKUGANS: Record<BakuganId, BakuganProfile> = {
  pyrax: {
    id: "pyrax",
    name: "Pyrax",
    attribute: "pyrus",
    tagline: "Fire in the core. Bold. Loud when it matters.",
    personality: "fiery, bold, protective, a little cocky",
    voice: { pitch: 0.88, rate: 1.06 },
    colors: {
      primary: "#ff5a1f",
      secondary: "#ffb347",
      glow: "#ff6b1a",
      deep: "#7a1c08",
      ash: "#e8d5c4",
    },
    aliases: ["pyrax", "pyrus", "fire", "ember"],
  },
  namiq: {
    id: "namiq",
    name: "Namiq",
    attribute: "aquos",
    tagline: "Tide-steady. Calm words. Deep focus.",
    personality: "calm, thoughtful, gentle, precise",
    voice: { pitch: 1.12, rate: 0.94 },
    colors: {
      primary: "#2ec4b6",
      secondary: "#7bdff2",
      glow: "#48cae4",
      deep: "#023e8a",
      ash: "#d8f3ff",
    },
    aliases: ["namiq", "aquos", "water", "tide"],
  },
  vexar: {
    id: "vexar",
    name: "Vexar",
    attribute: "darkus",
    tagline: "Shadow edge. Quiet. Sees what others miss.",
    personality: "mysterious, dry-witted, loyal, soft-spoken",
    voice: { pitch: 0.72, rate: 0.9 },
    colors: {
      primary: "#9b5de5",
      secondary: "#c77dff",
      glow: "#b5179e",
      deep: "#240046",
      ash: "#e0d4f7",
    },
    aliases: ["vexar", "darkus", "shadow", "void"],
  },
};

export const BAKUGAN_LIST = Object.values(BAKUGANS);

export function findBakuganByUtterance(text: string): BakuganId | null {
  const lower = text.toLowerCase().trim();
  // Prefer explicit names first
  for (const b of BAKUGAN_LIST) {
    if (new RegExp(`\\b${b.name.toLowerCase()}\\b`, "i").test(lower)) return b.id;
  }
  for (const b of BAKUGAN_LIST) {
    for (const a of b.aliases) {
      if (a === b.name.toLowerCase()) continue;
      if (
        (/\b(switch|talk to|wake|summon|hey|call|hi)\b/.test(lower) ||
          lower === a) &&
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
  if (!EMOTION_TAGS.includes(tag) || tag === "idle" || tag === "listening" || tag === "thinking") {
    // still accept happy/excited/etc.; idle/listening/thinking as reply moods map to calm/curious
    if (EMOTION_TAGS.includes(tag)) {
      return { emotion: tag === "idle" ? "calm" : tag, text: m[2]!.trim() };
    }
    return { emotion: "curious", text: m[2]!.trim() };
  }
  return { emotion: tag, text: m[2]!.trim() };
}

/** Split into speakable sentences, keeping punctuation. */
export function splitSentences(text: string): string[] {
  const cleaned = text.replace(/\*[^*]+\*/g, " ").replace(/\s+/g, " ").trim();
  if (!cleaned) return [];
  const parts = cleaned.match(/[^.!?]+[.!?]+|[^.!?]+$/g);
  return (parts ?? [cleaned]).map((s) => s.trim()).filter(Boolean);
}
