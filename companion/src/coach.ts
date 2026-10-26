import { BAKUGANS, type BakuganId, type Emotion } from "./bakugans";
import type { Drill } from "./training";

export type CoachLine = { emotion: Emotion; text: string };

function who(name: string | null) {
  return name ?? "partner";
}

/** Spoken after a drill unlocks — points at the next one. */
export function coachUnlockLine(
  id: BakuganId,
  unlocked: Drill,
  next: Drill | null,
  partnerName: string | null,
): CoachLine {
  const n = who(partnerName);
  const more = next ? nextHint(id, next, n) : allDone(id, n);
  if (id === "preyas") {
    return {
      emotion: "excited",
      text: `Whoop — ${unlocked.title} etched! ${more}`,
    };
  }
  if (id === "pyrax") {
    return {
      emotion: "angry",
      text: `${unlocked.title} burned in. ${more}`,
    };
  }
  return {
    emotion: "neutral",
    text: `${unlocked.title}. Logged. ${more}`,
  };
}

/** Wake / idle / "what's next" — one short coach beat. */
export function coachNextLine(
  id: BakuganId,
  next: Drill,
  partnerName: string | null,
): CoachLine {
  const n = who(partnerName);
  return { emotion: "thinking", text: nextHint(id, next, n) };
}

function nextHint(id: BakuganId, next: Drill, n: string): string {
  if (id === "preyas") {
    return `Next drill, ${n}: ${next.title}. ${next.how}`;
  }
  if (id === "pyrax") {
    return `Next: ${next.title}. ${next.how}`;
  }
  return `Then — ${next.title}. ${next.how}`;
}

function allDone(id: BakuganId, n: string): string {
  if (id === "preyas") {
    return `That's the whole map for now, ${n}. Keep bouncing — real body stays the dream stage.`;
  }
  if (id === "pyrax") {
    return `Map's complete. Mind's ready. Chassis later.`;
  }
  return `The drills are done. The body waits.`;
}

export function coachIdleLine(
  id: BakuganId,
  next: Drill,
  partnerName: string | null,
): CoachLine {
  const n = who(partnerName);
  if (id === "preyas") {
    return {
      emotion: "thinking",
      text: `Hey ${n}… still here. Wanna etch ${next.title}? ${next.how}`,
    };
  }
  if (id === "pyrax") {
    return {
      emotion: "neutral",
      text: `Core's warm. ${next.title} when you're ready. ${next.how}`,
    };
  }
  return {
    emotion: "neutral",
    text: `…${next.title} is waiting. ${next.how}`,
  };
}

export function partnerLabel(id: BakuganId) {
  return BAKUGANS[id].name;
}
