import {
  CANONICAL_MOODS,
  normalizeMood,
  parseTagged,
  react,
  splitSentences,
  stripThink,
  StreamingMoodParser,
  moodPromptLine,
} from "./index.ts";

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(msg);
}

// Canonical set
assert(CANONICAL_MOODS.length === 9, "9 canonical moods");
assert(normalizeMood("happy") === "happy", "happy");
assert(normalizeMood("amused") === "happy", "amused→happy");
assert(normalizeMood("fierce") === "angry", "fierce→angry");
assert(normalizeMood("calm") === "neutral", "calm→neutral");
assert(normalizeMood("curious") === "thinking", "curious→thinking");
assert(normalizeMood("mysterious") === "neutral", "mysterious→neutral");
assert(normalizeMood("determined") === "battle", "determined→battle");
assert(normalizeMood("idle") === "neutral", "idle→neutral");
assert(normalizeMood("nope") === "thinking", "unknown→thinking");

// Tagged parse
assert(parseTagged("[happy] Hey!").mood === "happy", "tag happy");
assert(parseTagged("[happy] Hey!").text === "Hey!", "text");
assert(parseTagged("[angry] Grr").mood === "angry", "angry canon");
assert(parseTagged("[fierce] Grr").mood === "angry", "fierce alias");
assert(parseTagged("[exc").complete === false, "partial tag");
assert(parseTagged("").complete === false, "empty");
assert(parseTagged("[happy]").complete === true, "tag only");
assert(react("[battle] Fight!").emotion === "battle", "react battle");
assert(react("no tag").emotion === "thinking", "fallback");

// Think blocks never spoken
{
  const p = parseTagged("[happy] <think>secret plan</think> Hello partner!");
  assert(p.mood === "happy", "think mood");
  assert(p.text === "Hello partner!", "think stripped: " + p.text);
  assert(!p.text.includes("secret"), "no leak");
}
{
  const p = parseTagged("[sad] Hi <think>unclosed");
  assert(p.text === "Hi", "open think dropped: " + JSON.stringify(p.text));
  assert(p.inThink === true, "inThink");
}
assert(stripThink("a <think>x</think> b").speakable === "a b", "strip middle");

// Streaming: mood before full sentence
{
  const s = new StreamingMoodParser();
  let snap = s.push("[ang");
  assert(snap.moodComplete === false, "stream partial");
  snap = s.push("ry] Whoop!");
  assert(snap.moodComplete === true, "stream mood ready");
  assert(snap.mood === "angry", "stream angry");
  assert(snap.speakable.includes("Whoop"), "stream text");
}
{
  const s = new StreamingMoodParser();
  s.push("[happy] <think>nope</think> Say now!");
  const snap = s.snapshot();
  assert(snap.mood === "happy", "stream happy");
  assert(!snap.speakable.includes("nope"), "stream no think");
  assert(snap.speakable.includes("Say now"), "stream speakable");
}

assert(splitSentences("A. B! C?").length === 3, "chunk");
assert(moodPromptLine().includes("[battle]"), "prompt lists battle");
assert(!moodPromptLine().includes("[fierce]"), "prompt no fierce");

console.log("mood package tests OK");
