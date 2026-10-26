import { motionTargets, normalizeMood, react } from "./index";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

assert(react("[happy] Hey partner!").emotion === "happy", "mood");
assert(react("[happy] Hey partner!").text === "Hey partner!", "text");
assert(react("[angry] Grr").emotion === "fierce", "angry→fierce");
assert(react("[battle] Go!").emotion === "determined", "battle→determined");
assert(normalizeMood("EXCITED") === "excited", "normalize");
assert(react("no tag").emotion === "curious", "fallback");

const excited = motionTargets("excited", "sphere", false, false);
assert(excited.open >= 1, "excited snaps open");
assert(excited.openSnap > 0.8, "excited spring open");
const listening = motionTargets("listening", "sphere", true, false);
assert(listening.lean > 0.4, "listening leans in");
const sad = motionTargets("sad", "sphere", false, false);
assert(sad.droop >= 1 && sad.eye < 0.3, "sad droops + dims");

console.log("body-core react() tests OK");
