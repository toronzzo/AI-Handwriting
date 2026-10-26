import { parseEmotionPrefix, splitSentences } from "./bakugans.ts";
import { stripThink, StreamingMoodParser } from "../../bakugan-buddy/packages/mood/src/index.ts";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

assert(parseEmotionPrefix("[happy] Hey partner!").emotion === "happy", "mood");
assert(parseEmotionPrefix("[happy] Hey partner!").text === "Hey partner!", "text");
assert(parseEmotionPrefix("[angry] Grr").emotion === "angry", "angry");
assert(parseEmotionPrefix("[fierce] Grr").emotion === "angry", "fierce→angry");
assert(parseEmotionPrefix("[amused] Heh").emotion === "happy", "amused→happy");
assert(parseEmotionPrefix("[exc").complete === false, "partial");
assert(parseEmotionPrefix("").complete === false, "wait empty");
assert(parseEmotionPrefix("[happy]").complete === true, "tag only");
assert(parseEmotionPrefix("[happy] One. Two!").text === "One. Two!", "rest");
assert(parseEmotionPrefix("[sad] Hi <think>x</think> There").text === "Hi There", "think stripped");
assert(splitSentences("A. B! C?").length === 3, "chunk");

const stream = new StreamingMoodParser();
assert(stream.push("[ang").moodComplete === false, "stream wait");
assert(stream.push("ry] Go!").mood === "angry", "stream mood");
assert(stripThink("a <think>b</think> c").speakable === "a c", "strip");

console.log("parseMood tests OK");
