import { react, normalizeMood, motionTargets } from "./index.ts";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

assert(react("[happy] Hey").emotion === "happy", "happy");
assert(react("[angry] Grr").emotion === "angry", "angry canon");
assert(react("[fierce] Grr").emotion === "angry", "fierce→angry");
assert(react("[battle] Go!").emotion === "battle", "battle");
assert(react("[determined] Go!").emotion === "battle", "determined→battle");
assert(react("[amused] Heh").emotion === "happy", "amused→happy");
assert(react("no tag").emotion === "thinking", "fallback");
assert(normalizeMood("curious") === "thinking", "curious");
assert(motionTargets("angry", "sphere", false, false).shake > 0, "angry shake");
assert(motionTargets("battle", "sphere", false, false).aura === 1, "battle aura");

console.log("body-core react tests OK");
