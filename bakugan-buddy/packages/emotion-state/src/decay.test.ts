import { decayEmotion, setEmotionSnap } from "./decay.ts";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

const t0 = 1_700_000_000_000;
const angry = setEmotionSnap("fierce", 1, t0);
assert(angry.mood === "angry", "alias");

const soon = decayEmotion(angry, t0 + 60_000);
assert(soon.mood === "angry", "still angry after 1m");
assert(soon.intensity < 1, "intensity dropped");

const later = decayEmotion(angry, t0 + 60 * 60_000);
assert(later.mood === "neutral", "hour later → neutral: " + later.mood);

const sad = setEmotionSnap("sad", 1, t0);
const angry10 = decayEmotion(angry, t0 + 10 * 60_000);
const sad10 = decayEmotion(sad, t0 + 10 * 60_000);
assert(sad10.mood === "sad", "sad lasts longer");
assert(sad10.intensity > angry10.intensity, "sad decays slower than angry at 10m");

console.log("emotion decay tests OK");
