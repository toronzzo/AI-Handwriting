import { parseEmotionPrefix, splitSentences } from "./bakugans.ts";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

assert(parseEmotionPrefix("[happy] Hey partner!").emotion === "happy", "mood");
assert(parseEmotionPrefix("[happy] Hey partner!").text === "Hey partner!", "text");
assert(parseEmotionPrefix("[angry] Grr").emotion === "fierce", "angry");
assert(parseEmotionPrefix("[exc").complete === false, "partial");
assert(parseEmotionPrefix("").complete === false, "wait empty");
assert(parseEmotionPrefix("   ").complete === false, "wait space");
assert(parseEmotionPrefix("[happy]").complete === true, "tag only");
assert(parseEmotionPrefix("[happy] One. Two!").text === "One. Two!", "rest");
assert(splitSentences("A. B! C?").length === 3, "chunk");

console.log("parseMood tests OK");
