/** Shared mood parser + motion targets for body.html / Skia / web. */

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
  | "amused";

export type ThemeId = "aquos" | "pyrus" | "darkus";

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
]);

export function normalizeMood(m: string): Mood {
  const x = m.toLowerCase();
  if (x === "angry") return "fierce";
  return (MOODS.has(x) ? x : "curious") as Mood;
}

/** Parse `[mood] text` — product contract for every LLM reply. */
export function react(tagged: string): { emotion: Mood; text: string } {
  const parsed = parseMoodPrefix(tagged);
  return { emotion: parsed.emotion, text: parsed.text };
}

/** Incremental parser for streamed llama.cpp tokens. */
export function parseMoodPrefix(raw: string): {
  emotion: Mood;
  text: string;
  complete: boolean;
} {
  const s = raw.trimStart();
  // Wait for the first real token so FEEL does not fire on leading whitespace.
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
      emotion: normalizeMood(tag),
      text: s.slice(close + 1).trim(),
      complete: true,
    };
  }
  return { emotion: "curious", text: s.trim(), complete: true };
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
};

export function motionTargets(
  emotion: Mood,
  form: "sphere" | "battle",
  listening: boolean,
  talking: boolean,
): MotionTargets {
  const forceOpen = form === "battle" ? 1 : 0;
  let open = forceOpen;
  let droop = 0;
  let eye = 0.55;
  let wobble = listening ? 0.4 : 0.08;
  let claw = 0;
  let hopDrive = 0;
  let hopAmp = 0;
  let shake = 0;

  switch (emotion) {
    case "happy":
    case "amused":
      hopDrive = 7.5;
      hopAmp = 0.85;
      eye = 1;
      wobble = 0.2;
      break;
    case "excited":
      open = Math.max(open, 1);
      claw = 1;
      eye = 1;
      hopDrive = 5;
      hopAmp = 0.35;
      break;
    case "fierce":
      shake = 0.55;
      eye = 0.95;
      open = Math.max(open, 0.35);
      break;
    case "sad":
      droop = 1;
      eye = 0.22;
      wobble = 0.05;
      break;
    case "calm":
      eye = 0.5;
      break;
    case "curious":
      eye = 0.8;
      wobble = 0.25;
      open = Math.max(open, 0.15);
      break;
    case "listening":
      eye = 0.85;
      wobble = 0.4;
      break;
    case "thinking":
      eye = 0.45;
      wobble = 0.15;
      break;
    default:
      break;
  }
  if (talking && open < 0.2) open = Math.max(open, 0.12);
  return { open, droop, eye, wobble, claw, hopDrive, hopAmp, shake };
}
