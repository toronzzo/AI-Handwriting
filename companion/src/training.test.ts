import {
  applyTrainEvent,
  defaultTraining,
  looksLikeNameBond,
  nextDrill,
  wantsNextDrill,
} from "./training.ts";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

assert(looksLikeNameBond("I'm Alex") === true, "name Alex");
assert(looksLikeNameBond("i'm alex") === true, "lowercase name");
assert(looksLikeNameBond("my name is Sam") === true, "my name is");
assert(looksLikeNameBond("I'm sad") === false, "mood not name");
assert(looksLikeNameBond("I am angry") === false, "angry not name");

const named = applyTrainEvent(defaultTraining(), { kind: "user", text: "i'm alex" });
assert(named.newly.some((d) => d.id === "say_name"), "say_name unlock");

const sad = applyTrainEvent(defaultTraining(), { kind: "user", text: "I feel sad" });
assert(sad.newly.some((d) => d.id === "feel_sad"), "feel_sad");
const namedHappy = applyTrainEvent(defaultTraining(), { kind: "emotion", emotion: "happy" });
assert(!namedHappy.newly.some((d) => d.id === "feel_happy"), "name greeting is not happy-hop");
const thanks = applyTrainEvent(defaultTraining(), { kind: "user", text: "thanks, love you" });
assert(thanks.newly.some((d) => d.id === "feel_happy"), "thanks unlocks hop");

assert(nextDrill(defaultTraining())?.id === "say_name", "first drill");
assert(wantsNextDrill("what's next") === true, "what's next");
assert(wantsNextDrill("train me") === true, "train me");
assert(wantsNextDrill("hello") === false, "hello");

console.log("training tests OK");
