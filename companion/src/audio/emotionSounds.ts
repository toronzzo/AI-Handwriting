import type { Emotion } from "../bakugans";

let ctx: AudioContext | null = null;

function ac(): AudioContext {
  if (!ctx) ctx = new AudioContext();
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
}

/** Instant offline mood one-shots (synthesized — no asset download). */
export function playEmotionSound(emotion: Emotion) {
  try {
    const c = ac();
    const now = c.currentTime;
    switch (emotion) {
      case "excited":
      case "fierce":
        growl(c, now, 180, 0.12);
        blip(c, now + 0.05, 520, 0.08);
        break;
      case "happy":
        blip(c, now, 660, 0.07);
        blip(c, now + 0.08, 880, 0.06);
        break;
      case "amused":
        laugh(c, now);
        break;
      case "sad":
        blip(c, now, 220, 0.12, "sine", 0.08);
        blip(c, now + 0.12, 180, 0.14, "sine", 0.06);
        break;
      case "curious":
        blip(c, now, 480, 0.06);
        blip(c, now + 0.07, 620, 0.05);
        break;
      case "mysterious":
        growl(c, now, 90, 0.18);
        break;
      case "calm":
        blip(c, now, 320, 0.14, "sine", 0.05);
        break;
      case "listening":
        blip(c, now, 400, 0.04, "triangle", 0.03);
        break;
      default:
        break;
    }
  } catch {
    /* audio optional */
  }
}

/** Tiny acknowledge while the partner is still talking. */
export function playListenTick() {
  try {
    blip(ac(), ac().currentTime, 360 + Math.random() * 80, 0.035, "triangle", 0.025);
  } catch {
    /* ignore */
  }
}

function blip(
  c: AudioContext,
  when: number,
  freq: number,
  dur: number,
  type: OscillatorType = "sine",
  gain = 0.07,
) {
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, when);
  g.gain.setValueAtTime(0.0001, when);
  g.gain.exponentialRampToValueAtTime(gain, when + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, when + dur);
  o.connect(g);
  g.connect(c.destination);
  o.start(when);
  o.stop(when + dur + 0.02);
}

function growl(c: AudioContext, when: number, freq: number, dur: number) {
  const o = c.createOscillator();
  const g = c.createGain();
  const f = c.createBiquadFilter();
  o.type = "sawtooth";
  o.frequency.setValueAtTime(freq, when);
  o.frequency.exponentialRampToValueAtTime(freq * 0.7, when + dur);
  f.type = "lowpass";
  f.frequency.setValueAtTime(600, when);
  g.gain.setValueAtTime(0.0001, when);
  g.gain.exponentialRampToValueAtTime(0.05, when + 0.02);
  g.gain.exponentialRampToValueAtTime(0.0001, when + dur);
  o.connect(f);
  f.connect(g);
  g.connect(c.destination);
  o.start(when);
  o.stop(when + dur + 0.02);
}

function laugh(c: AudioContext, when: number) {
  [520, 600, 540, 680].forEach((f, i) => {
    blip(c, when + i * 0.07, f, 0.05, "square", 0.035);
  });
}
