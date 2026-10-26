/** Shared mood parser + motion targets for body.html / Skia / web.
 * Ground truth: docs/PREYAS_FROM_ANIME.md — emotion via body, not a cartoon face.
 */

export type Mood =
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
  | "amused"
  | "surprised"
  | "determined";

export type ThemeId = "aquos" | "pyrus" | "darkus" | "haos" | "subterra" | "ventus";

export type Theme = {
  id: ThemeId | string;
  shell: string;
  shellDeep: string;
  accent: string;
  accentHot: string;
  core: string;
  eye: string;
  claw: string;
};

export const THEMES: Record<ThemeId, Theme> = {
  aquos: {
    id: "aquos",
    shell: "#1a4fd6",
    shellDeep: "#0b2a8c",
    accent: "#5dfff0",
    accentHot: "#9ffff6",
    core: "#3de8ff",
    eye: "#ff2a2a",
    claw: "#7b5cff",
  },
  pyrus: {
    id: "pyrus",
    shell: "#e03a12",
    shellDeep: "#7a1408",
    accent: "#ffb347",
    accentHot: "#ffe08a",
    core: "#ff6b1a",
    eye: "#ffef5a",
    claw: "#ff8a3d",
  },
  darkus: {
    id: "darkus",
    shell: "#5b2d8e",
    shellDeep: "#240046",
    accent: "#c77dff",
    accentHot: "#e0aaff",
    core: "#b5179e",
    eye: "#ff4d6d",
    claw: "#9b5de5",
  },
  haos: {
    id: "haos",
    shell: "#e9e5d6",
    shellDeep: "#8f8870",
    accent: "#ffd60a",
    accentHot: "#fff3a6",
    core: "#ffe14d",
    eye: "#ff8a00",
    claw: "#ffe680",
  },
  subterra: {
    id: "subterra",
    shell: "#8b5a2b",
    shellDeep: "#3c220a",
    accent: "#f2b45a",
    accentHot: "#ffd29a",
    core: "#ff9a2e",
    eye: "#ffcf33",
    claw: "#c48a55",
  },
  ventus: {
    id: "ventus",
    shell: "#2e9a4c",
    shellDeep: "#0e431f",
    accent: "#c9ff6e",
    accentHot: "#e9ffb0",
    core: "#46f07a",
    eye: "#ff3b6b",
    claw: "#63d47d",
  },
};

const MOODS = new Set<string>([
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
  "surprised",
  "determined",
]);

const ALIASES: Record<string, Mood> = {
  angry: "fierce",
  mad: "fierce",
  rage: "fierce",
  neutral: "idle",
  normal: "idle",
  joy: "happy",
  glad: "happy",
  smile: "happy",
  laugh: "happy",
  hype: "excited",
  hyped: "excited",
  wow: "excited",
  upset: "sad",
  cry: "sad",
  crying: "sad",
  shocked: "surprised",
  shock: "surprised",
  surprise: "surprised",
  think: "thinking",
  hmm: "thinking",
  listen: "listening",
  battle: "determined",
  brave: "determined",
  fight: "determined",
  focused: "determined",
};

export function normalizeMood(m: string): Mood {
  const x = m.toLowerCase().trim();
  if (ALIASES[x]) return ALIASES[x]!;
  return (MOODS.has(x) ? x : "curious") as Mood;
}

/** Parse `[mood] text` — product contract for every LLM reply. */
export function react(tagged: string): { emotion: Mood; text: string } {
  const m = tagged.trim().match(/^\[([a-z]+)\]\s*([\s\S]*)$/i);
  if (m) return { emotion: normalizeMood(m[1]!), text: m[2]!.trim() };
  return { emotion: "curious", text: tagged.trim() };
}

export type MotionTargets = {
  open: number;
  droop: number;
  eye: number;
  wobble: number;
  claw: number;
  hopDrive: number;
  hopAmp: number;
  shake: number;
  /** Forward lean toward partner (listening / fierce). */
  lean: number;
  /** Soft idle rock amplitude. */
  rock: number;
  /** Aura / attribute energy 0–1. */
  aura: number;
  /** Higher = springier open (anime magnet snap). */
  openSnap: number;
};

export type MotionStyle = {
  bounce?: number;
  openSnap?: number;
  idleRock?: number;
  listenLean?: number;
  angryShake?: number;
  sadDroop?: number;
  talkBob?: number;
};

const DEFAULT_STYLE: Required<MotionStyle> = {
  bounce: 1,
  openSnap: 0.9,
  idleRock: 0.35,
  listenLean: 0.8,
  angryShake: 1,
  sadDroop: 1,
  talkBob: 1,
};

/**
 * Anime body-language targets. No cartoon face — feelings live in motion + eye glow.
 * See docs/PREYAS_FROM_ANIME.md §3.
 */
export function motionTargets(
  emotion: Mood,
  form: "sphere" | "battle",
  listening: boolean,
  talking: boolean,
  style: MotionStyle = {},
): MotionTargets {
  const s = { ...DEFAULT_STYLE, ...style };
  const forceOpen = form === "battle" ? 1 : 0;
  let open = forceOpen;
  let droop = 0;
  let eye = 0.55;
  let wobble = listening ? 0.4 : 0.08;
  let claw = 0;
  let hopDrive = 0;
  let hopAmp = 0;
  let shake = 0;
  let lean = listening ? 0.55 * s.listenLean : 0;
  let rock = 0.08 + 0.12 * s.idleRock;
  let aura = 0;
  let openSnap = 0.45 + 0.4 * s.openSnap;

  switch (emotion) {
    case "happy":
    case "amused":
      hopDrive = 7.5 * s.bounce;
      hopAmp = 0.85 * s.bounce;
      eye = 1;
      wobble = 0.2;
      rock = 0.12;
      aura = 0.15;
      break;
    case "excited":
      open = Math.max(open, 1);
      claw = 1;
      eye = 1;
      hopDrive = 5 * s.bounce;
      hopAmp = 0.35 * s.bounce;
      aura = 0.45;
      openSnap = 0.85 + 0.15 * s.openSnap;
      rock = 0;
      break;
    case "determined":
      open = Math.max(open, 1);
      claw = 0.35;
      eye = 1;
      aura = 1;
      lean = 0.4;
      openSnap = 0.9;
      rock = 0;
      break;
    case "fierce":
      shake = 0.55 * s.angryShake;
      eye = 0.95;
      open = Math.max(open, 0.35);
      lean = 0.7;
      aura = 0.7;
      rock = 0;
      break;
    case "sad":
      droop = 1 * s.sadDroop;
      eye = 0.22;
      wobble = 0.05;
      rock = 0.04;
      lean = -0.15;
      break;
    case "calm":
    case "idle":
      eye = 0.5;
      rock = 0.1 + 0.2 * s.idleRock;
      break;
    case "curious":
      eye = 0.8;
      wobble = 0.25;
      open = Math.max(open, 0.15);
      break;
    case "surprised":
      open = Math.max(open, 1);
      eye = 1;
      hopAmp = 0.2;
      hopDrive = 2;
      aura = 0.35;
      openSnap = 1;
      rock = 0;
      break;
    case "mysterious":
      eye = 0.4;
      wobble = 0.12;
      rock = 0.06;
      break;
    case "listening":
      eye = 0.85;
      wobble = 0.4;
      lean = 0.8 * s.listenLean;
      open = Math.max(open, 0.12);
      rock = 0.05;
      break;
    case "thinking":
      eye = 0.45;
      wobble = 0.15;
      lean = -0.1;
      rock = 0.18;
      break;
    default:
      break;
  }
  if (talking && open < 0.2) open = Math.max(open, 0.12);
  return {
    open,
    droop,
    eye,
    wobble,
    claw,
    hopDrive,
    hopAmp,
    shake,
    lean,
    rock,
    aura,
    openSnap,
  };
}
