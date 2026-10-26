import { normalizeMood, parseMoodPrefix, react } from "./index.ts";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

assert(react("[happy] Hey partner!").emotion === "happy", "mood");
assert(react("[happy] Hey partner!").text === "Hey partner!", "text");
assert(react("[angry] Grr").emotion === "fierce", "angry→fierce");
assert(normalizeMood("EXCITED") === "excited", "normalize");
assert(react("no tag").emotion === "curious", "fallback");
assert(parseMoodPrefix("[happy]").complete === true, "empty body ok");
assert(parseMoodPrefix("[exc").complete === false, "partial tag");
assert(parseMoodPrefix("[angry] Grr").emotion === "fierce", "stream angry");
assert(parseMoodPrefix("").complete === false, "wait on empty stream");
assert(parseMoodPrefix("   ").complete === false, "wait on whitespace");
assert(parseMoodPrefix("[").complete === false, "open bracket only");

console.log("body-core react() tests OK");
