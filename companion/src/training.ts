import type { BakuganId, Emotion } from "./bakugans";
import type { PartnerMemory } from "./memory";

/** Path from soft ball → denser mind → someday a real body. */
export type BodyStage =
  | "sphere"
  | "nervous_system"
  | "voice_sync"
  | "muscle_memory"
  | "chassis_ready"
  | "real_body";

export type DrillId =
  | "say_name"
  | "feel_happy"
  | "feel_sad"
  | "pop_open"
  | "switch_partner"
  | "remember_fact"
  | "mic_listen"
  | "watch_neurons"
  | "train_voice"
  | "bond_30"
  | "bond_60"
  | "body_blueprint";

export type Drill = {
  id: DrillId;
  title: string;
  how: string;
  unlocks: string;
  stage: BodyStage;
  xp: number;
};

export const BODY_STAGES: {
  id: BodyStage;
  label: string;
  blurb: string;
}[] = [
  {
    id: "sphere",
    label: "1 · Sphere",
    blurb: "Alive as a ball — hops, glow, pop-open.",
  },
  {
    id: "nervous_system",
    label: "2 · Nervous system",
    blurb: "You can watch neurons fire before words leave.",
  },
  {
    id: "voice_sync",
    label: "3 · Voice sync",
    blurb: "Body bobs locked to speech — mind and mouth together.",
  },
  {
    id: "muscle_memory",
    label: "4 · Muscle memory",
    blurb: "Drills stick. Bond and skills become habits.",
  },
  {
    id: "chassis_ready",
    label: "5 · Chassis ready",
    blurb: "Blueprint locked for a future physical shell.",
  },
  {
    id: "real_body",
    label: "6 · Real body",
    blurb: "Someday — motors, sensors, the same mind walking.",
  },
];

export const DRILLS: Drill[] = [
  {
    id: "say_name",
    title: "Name bond",
    how: 'Tell him: "I\'m YourName"',
    unlocks: "Partner identity neuron",
    stage: "sphere",
    xp: 10,
  },
  {
    id: "feel_happy",
    title: "Happy hop",
    how: 'Say something kind — "love you" or "thanks"',
    unlocks: "Joy motor pathway",
    stage: "sphere",
    xp: 8,
  },
  {
    id: "feel_sad",
    title: "Soft droop",
    how: 'Share a heavy feeling — "I feel sad"',
    unlocks: "Empathy dampers",
    stage: "sphere",
    xp: 8,
  },
  {
    id: "pop_open",
    title: "Pop open",
    how: 'Command: "pop open" or "battle"',
    unlocks: "Shell actuator map",
    stage: "sphere",
    xp: 10,
  },
  {
    id: "watch_neurons",
    title: "Watch the core",
    how: "Send any message and watch SENSE→SPEECH light up",
    unlocks: "Nervous system readout",
    stage: "nervous_system",
    xp: 12,
  },
  {
    id: "train_voice",
    title: "Voice sync",
    how: "Leave Voice on and let a full reply speak",
    unlocks: "Speech–body coupler",
    stage: "voice_sync",
    xp: 12,
  },
  {
    id: "remember_fact",
    title: "Memory etch",
    how: 'Say: "remember I like …"',
    unlocks: "Long-term weight store",
    stage: "muscle_memory",
    xp: 14,
  },
  {
    id: "switch_partner",
    title: "Shell swap",
    how: 'Say: "switch to Pyrax" or "Vexar"',
    unlocks: "Multi-chassis bus",
    stage: "muscle_memory",
    xp: 10,
  },
  {
    id: "mic_listen",
    title: "Ear canal",
    how: "Turn Mic on and speak a line (Chrome/Edge)",
    unlocks: "Audio afferent nerves",
    stage: "voice_sync",
    xp: 14,
  },
  {
    id: "bond_30",
    title: "Bond 30",
    how: "Keep chatting until bond hits 30",
    unlocks: "Stable training baseline",
    stage: "muscle_memory",
    xp: 20,
  },
  {
    id: "bond_60",
    title: "Bond 60",
    how: "Push bond to 60 — deeper weights",
    unlocks: "Chassis blueprint draft",
    stage: "chassis_ready",
    xp: 30,
  },
  {
    id: "body_blueprint",
    title: "Body blueprint",
    how: 'Say: "show body blueprint" or "real body"',
    unlocks: "Real-body roadmap (future motors)",
    stage: "chassis_ready",
    xp: 25,
  },
];

export type TrainingState = {
  completed: DrillId[];
  xp: number;
  seenNeurons: boolean;
  heardVoice: boolean;
  usedMic: boolean;
};

export function defaultTraining(): TrainingState {
  return { completed: [], xp: 0, seenNeurons: false, heardVoice: false, usedMic: false };
}

export function loadTraining(): TrainingState {
  try {
    const raw = localStorage.getItem("bakugan-training-v1");
    if (!raw) return defaultTraining();
    const p = JSON.parse(raw) as Partial<TrainingState>;
    return {
      completed: Array.isArray(p.completed) ? (p.completed as DrillId[]) : [],
      xp: typeof p.xp === "number" ? p.xp : 0,
      seenNeurons: Boolean(p.seenNeurons),
      heardVoice: Boolean(p.heardVoice),
      usedMic: Boolean(p.usedMic),
    };
  } catch {
    return defaultTraining();
  }
}

export function saveTraining(t: TrainingState) {
  localStorage.setItem("bakugan-training-v1", JSON.stringify(t));
}

export function stageProgress(t: TrainingState): {
  current: BodyStage;
  unlocked: BodyStage[];
  next: BodyStage | null;
} {
  const order = BODY_STAGES.map((s) => s.id);
  const unlocked = new Set<BodyStage>(["sphere"]);
  if (t.completed.includes("watch_neurons") || t.seenNeurons) unlocked.add("nervous_system");
  if (t.completed.includes("train_voice") || t.heardVoice) unlocked.add("voice_sync");
  if (
    t.completed.includes("remember_fact") ||
    t.completed.includes("bond_30") ||
    t.xp >= 40
  ) {
    unlocked.add("muscle_memory");
  }
  if (t.completed.includes("bond_60") || t.completed.includes("body_blueprint") || t.xp >= 90) {
    unlocked.add("chassis_ready");
  }
  // real_body stays locked — the dream stage
  let current: BodyStage = "sphere";
  for (const id of order) {
    if (id === "real_body") break;
    if (unlocked.has(id)) current = id;
  }
  const idx = order.indexOf(current);
  const next = (order[idx + 1] ?? null) as BodyStage | null;
  return { current, unlocked: [...unlocked], next };
}

export type TrainEvent = {
  kind: "user" | "emotion" | "speak" | "neurons" | "mic" | "voice";
  text?: string;
  emotion?: Emotion;
  mem?: PartnerMemory;
  id?: BakuganId;
};

/** Complete drills based on what just happened. Returns newly finished drills. */
export function applyTrainEvent(t: TrainingState, ev: TrainEvent): {
  state: TrainingState;
  newly: Drill[];
} {
  const done = new Set(t.completed);
  const newly: Drill[] = [];
  const mark = (id: DrillId) => {
    if (done.has(id)) return;
    done.add(id);
    const d = DRILLS.find((x) => x.id === id);
    if (d) newly.push(d);
  };

  let seenNeurons = t.seenNeurons;
  let heardVoice = t.heardVoice;
  let usedMic = t.usedMic;

  if (ev.kind === "neurons") {
    seenNeurons = true;
    mark("watch_neurons");
  }
  if (ev.kind === "voice") {
    heardVoice = true;
    mark("train_voice");
  }
  if (ev.kind === "mic") {
    usedMic = true;
    mark("mic_listen");
  }

  if (ev.kind === "user" && ev.text) {
    const lower = ev.text.toLowerCase();
    if (/(?:i'?m|i am|my name is|call me)\s+[A-Z]/i.test(ev.text) && !/\b(sad|angry|happy)\b/i.test(ev.text)) {
      mark("say_name");
    }
    if (/\b(pop open|battle|open|transform)\b/.test(lower)) mark("pop_open");
    if (/\bremember\b/.test(lower)) mark("remember_fact");
    if (/\b(switch to|pyrax|vexar|preyas)\b/.test(lower) && /\b(switch|talk to|wake)\b/.test(lower)) {
      mark("switch_partner");
    }
    if (/\b(real body|body blueprint|chassis)\b/.test(lower)) mark("body_blueprint");
  }

  if (ev.kind === "emotion" && ev.emotion) {
    if (ev.emotion === "happy" || ev.emotion === "amused") mark("feel_happy");
    if (ev.emotion === "sad") mark("feel_sad");
  }

  if (ev.mem) {
    const bond = ev.mem.bonds[ev.mem.activeId] ?? 0;
    if (bond >= 30) mark("bond_30");
    if (bond >= 60) mark("bond_60");
  }

  const xp =
    [...done].reduce((sum, id) => sum + (DRILLS.find((d) => d.id === id)?.xp ?? 0), 0);

  return {
    state: {
      completed: [...done],
      xp,
      seenNeurons,
      heardVoice,
      usedMic,
    },
    newly,
  };
}

export function nextDrill(t: TrainingState): Drill | null {
  return DRILLS.find((d) => !t.completed.includes(d.id)) ?? null;
}
