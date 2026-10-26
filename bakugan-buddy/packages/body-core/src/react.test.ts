import { normalizeMood, react } from "./index";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

assert(react("[happy] Hey partner!").emotion === "happy", "mood");
assert(react("[happy] Hey partner!").text === "Hey partner!", "text");
assert(react("[angry] Grr").emotion === "fierce", "angry→fierce");
assert(normalizeMood("EXCITED") === "excited", "normalize");
assert(react("no tag").emotion === "curious", "fallback");

console.log("body-core react() tests OK");
