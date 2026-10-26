import {
  BAKUGANS,
  findBakuganByUtterance,
  parseEmotionPrefix,
  splitSentences,
  type BakuganId,
  type Emotion,
} from "./bakugans";
import type { PartnerMemory } from "./memory";
import type { Form } from "./types";
import { pingStudio, streamStudioTokens } from "./studio";

export type BrainResult = {
  tagged: string;
  emotion: Emotion;
  text: string;
  memory: PartnerMemory;
  switchedTo?: BakuganId;
};

function pick<T>(items: T[]): T {
  return items[Math.floor(Math.random() * items.length)]!;
}

function bump(mem: PartnerMemory, id: BakuganId, n: number): PartnerMemory {
  const bonds = { ...mem.bonds, [id]: Math.min(100, Math.max(0, mem.bonds[id] + n)) };
  return { ...mem, bonds };
}

function remember(mem: PartnerMemory, fact: string): PartnerMemory {
  if (mem.facts.includes(fact)) return mem;
  return { ...mem, facts: [...mem.facts, fact].slice(-40) };
}

function setForm(mem: PartnerMemory, id: BakuganId, form: Form): PartnerMemory {
  return { ...mem, forms: { ...mem.forms, [id]: form } };
}

const NOT_A_NAME = new Set([
  "sad",
  "happy",
  "angry",
  "mad",
  "scared",
  "tired",
  "lonely",
  "fine",
  "good",
  "okay",
  "ok",
  "excited",
  "anxious",
  "stressed",
  "back",
  "here",
  "ready",
  "so",
  "just",
  "feeling",
  "really",
]);

function extractName(text: string): string | null {
  // Prefer explicit name phrases; "I'm sad/angry" is mood, not a name.
  const explicit = text
    .trim()
    .match(/(?:my name is|call me)\s+([A-Za-z][a-zA-Z'-]{1,24})/i);
  if (explicit?.[1] && !NOT_A_NAME.has(explicit[1].toLowerCase())) {
    return capitalize(explicit[1]);
  }

  const m = text
    .trim()
    .match(/^(?:i[''\u2019]?m|i am)\s+([A-Za-z][a-zA-Z'-]{1,24})\.?$/i);
  if (!m?.[1]) return null;
  if (NOT_A_NAME.has(m[1].toLowerCase())) return null;
  return capitalize(m[1]);
}

function capitalize(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function pack(
  emotion: Emotion,
  text: string,
  memory: PartnerMemory,
  switchedTo?: BakuganId,
): BrainResult {
  return { tagged: `[${emotion}] ${text}`, emotion, text, memory, switchedTo };
}

export function think(userText: string, mem: PartnerMemory): BrainResult {
  const text = userText.trim();
  const lower = text.toLowerCase();
  let next = { ...mem };
  const id = next.activeId;
  const profile = BAKUGANS[id];
  const who = next.partnerName ?? "partner";

  const switchTo = findBakuganByUtterance(text);
  if (
    switchTo &&
    switchTo !== id &&
    (/\b(switch|talk to|wake|summon|hey|call)\b/.test(lower) ||
      lower.trim() === BAKUGANS[switchTo].name.toLowerCase() ||
      BAKUGANS[switchTo].aliases.some((a) => lower.trim() === a) ||
      lower.includes(BAKUGANS[switchTo].name.toLowerCase()))
  ) {
    next = { ...next, activeId: switchTo };
    const emotion: Emotion =
      switchTo === "preyas" ? "excited" : switchTo === "pyrax" ? "fierce" : "mysterious";
    const line =
      switchTo === "preyas"
        ? `Heh — Preyas rollin' in! Miss me, ${who}?`
        : switchTo === "pyrax"
          ? `Pyrax here. Core's hot — let's go, ${who}.`
          : `Vexar. Quiet now. I'm listening, ${who}.`;
    return pack(emotion, line, bump(next, switchTo, 2), switchTo);
  }

  const name = extractName(text);
  if (name) {
    next = bump(remember({ ...next, partnerName: name }, `Partner's name is ${name}`), id, 5);
    if (id === "preyas") {
      return pack(
        "happy",
        pick([
          `${name}-han! Say, that's a name I can bounce to. I'm Preyas — your Aquos ball.`,
          `Alright, ${name}! Stick with me and we'll make a splash.`,
        ]),
        next,
      );
    }
    if (id === "pyrax") {
      return pack("happy", `${name}. Burned into my core. I'm Pyrax — say the word.`, next);
    }
    return pack("mysterious", `${name}. Noted. I'm Vexar. I don't forget.`, next);
  }

  if (/\b(open|battle|stand|transform|pop)\b/.test(lower)) {
    next = setForm(bump(next, id, 2), id, "battle");
    if (id === "preyas") {
      return pack("excited", `Whoop — poppin' open! Claws out, ${who}!`, next);
    }
    if (id === "pyrax") {
      return pack("fierce", `Battle form! Ready when you are, ${who}.`, next);
    }
    return pack("fierce", `Unfurling. Point me, ${who}.`, next);
  }

  if (/\b(rest|sleep|sphere|close|fold|chill)\b/.test(lower)) {
    next = setForm(next, id, "sphere");
    return pack(
      "calm",
      id === "preyas"
        ? `Sealin' up… still peekin' though. Don't you worry.`
        : `Back to sphere. Still here.`,
      next,
    );
  }

  if (/\b(hi|hello|hey|yo|sup)\b/.test(lower)) {
    next = bump(next, id, 1);
    if (id === "preyas") {
      return pack(
        "happy",
        pick([
          `Hey hey${next.partnerName ? `, ${next.partnerName}` : ""}! Preyas in the house — what's shakin'?`,
          `Well look who it is! Bounce me a hello back?`,
        ]),
        next,
      );
    }
    if (id === "pyrax") {
      return pack("excited", `Hey${next.partnerName ? `, ${next.partnerName}` : ""}. Core's warm — talk.`, next);
    }
    return pack("mysterious", `…Hey${next.partnerName ? `, ${next.partnerName}` : ""}. Go on.`, next);
  }

  if (/\b(how are you|how'?s it going|you ok)\b/.test(lower)) {
    return pack(
      "happy",
      id === "preyas"
        ? `Feelin' bouncy! Bond ${next.bonds[id]}/100. You good, ${who}?`
        : `Bond ${next.bonds[id]}/100. ${profile.name}'s steady. You?`,
      next,
    );
  }

  if (/\b(sad|lonely|anxious|stress|stressed|tired|hurt|scared)\b/.test(lower)) {
    next = bump(next, id, 3);
    if (id === "preyas") {
      return pack(
        "sad",
        `Aw, ${who}… c'mere. I'll droop with ya a sec, then we bounce back together.`,
        next,
      );
    }
    return pack("sad", `Hey ${who}. I've got you. Slow and steady.`, next);
  }

  if (/\b(mad|angry|annoyed|furious)\b/.test(lower)) {
    return pack(
      "fierce",
      id === "preyas"
        ? `Ooh, I feel that heat! Want me to shake it out with ya?`
        : `Yeah. Let's put that fire somewhere useful.`,
      bump(next, id, 1),
    );
  }

  if (/\b(love you|miss you|thank|thanks)\b/.test(lower)) {
    next = bump(next, id, 4);
    return pack(
      "happy",
      id === "preyas"
        ? `Heh — you got me hoppin', ${who}. Right back atcha!`
        : `Bond spiked. Right back at you, ${who}.`,
      next,
    );
  }

  if (/\b(joke|funny|laugh)\b/.test(lower)) {
    return pack(
      "amused",
      pick([
        `Why'd the Bakugan bring a ladder? To raise its G-Power! Wahaha!`,
        `Gate Card walks into an arena… and I already popped open for the punchline.`,
      ]),
      bump(next, id, 1),
    );
  }

  if (/\b(who are you|what are you|your name)\b/.test(lower)) {
    return pack(
      id === "preyas" ? "excited" : id === "pyrax" ? "fierce" : "mysterious",
      `I'm ${profile.name} — ${profile.attribute}. ${profile.tagline}`,
      next,
    );
  }

  if (/\b(bond|status|who'?s here|partners)\b/.test(lower)) {
    const roster = (["preyas", "pyrax", "vexar"] as BakuganId[])
      .map((k) => `${BAKUGANS[k].name} ${next.bonds[k]}`)
      .join(" · ");
    return pack("curious", `Active: ${profile.name}. Bonds — ${roster}.`, next);
  }

  if (/\b(real body|body blueprint|chassis|neurons|train me|training)\b/.test(lower)) {
    return pack(
      "curious",
      id === "preyas"
        ? `Heh — peek at my core, ${who}. Sense lights first, then feel, then I pick words, then the ball moves. Train me drill by drill… someday that same mind gets motors. Real body. Not yet — but we're etchín' the blueprint.`
        : `Watch the neural stack: sense → feel → intent → speak → body. Train step by step toward a chassis.`,
      next,
    );
  }

  if (/\bremember\b/.test(lower)) {
    const fact = text.replace(/^.*remember\s+/i, "").trim();
    if (fact.length > 2) {
      next = bump(remember(next, fact), id, 2);
      return pack("happy", `Got it locked: "${fact}." Won't forget, ${who}.`, next);
    }
  }

  next = bump(next, id, 1);
  if (id === "preyas") {
    return pack(
      "curious",
      pick([
        `Mm-hm, I'm listenin', ${who}. Keep talkin' — I'll bounce along.`,
        `Say now… what's the real splash we need to make?`,
        `I gotcha. Want a pep talk, a plan, or just a buddy ball?`,
      ]),
      next,
    );
  }
  if (id === "pyrax") {
    return pack(
      "curious",
      pick([
        `I'm with you, ${who}. Pep talk, plan, or listening?`,
        `Fire says go. What's the move?`,
      ]),
      next,
    );
  }
  return pack(
    "mysterious",
    pick([
      `Interesting, ${who}. Say the part you haven't said yet.`,
      `The quiet between words — that's where I listen.`,
    ]),
    next,
  );
}

/** Deterministic memory/form/switch — never ask the LLM to mutate this. */
export function applyLocalEffects(
  userText: string,
  mem: PartnerMemory,
): { memory: PartnerMemory; switchedTo?: BakuganId } {
  const text = userText.trim();
  const lower = text.toLowerCase();
  let next = { ...mem };
  const id = next.activeId;
  let switchedTo: BakuganId | undefined;

  const switchTo = findBakuganByUtterance(text);
  if (
    switchTo &&
    switchTo !== id &&
    (/\b(switch|talk to|wake|summon|hey|call)\b/.test(lower) ||
      lower.trim() === BAKUGANS[switchTo].name.toLowerCase() ||
      BAKUGANS[switchTo].aliases.some((a) => lower.trim() === a) ||
      lower.includes(BAKUGANS[switchTo].name.toLowerCase()))
  ) {
    next = bump({ ...next, activeId: switchTo }, switchTo, 2);
    return { memory: next, switchedTo: switchTo };
  }

  const name = extractName(text);
  if (name) {
    next = bump(remember({ ...next, partnerName: name }, `Partner's name is ${name}`), id, 5);
    return { memory: next };
  }

  if (/\b(open|battle|stand|transform|pop)\b/.test(lower)) {
    next = setForm(bump(next, id, 2), id, "battle");
    return { memory: next };
  }
  if (/\b(rest|sleep|sphere|close|fold|chill)\b/.test(lower)) {
    next = setForm(next, id, "sphere");
    return { memory: next };
  }
  if (/\bremember\b/.test(lower)) {
    const fact = text.replace(/^.*remember\s+/i, "").trim();
    if (fact.length > 2) {
      next = bump(remember(next, fact), id, 2);
      return { memory: next };
    }
  }
  next = bump(next, id, 1);
  return { memory: next, switchedTo };
}

export type NeuralEvent =
  | {
      type: "neural";
      layer: "sense" | "feel" | "intend" | "speak" | "body";
      label: string;
    }
  | {
      type: "preview";
      /** Full reply text decided — shown before speech finishes */
      willSay: string;
      emotion: Emotion;
    }
  | { type: "emotion"; emotion: Emotion; memory: PartnerMemory; switchedTo?: BakuganId }
  | { type: "sentence"; sentence: string; index: number }
  | { type: "done"; result: BrainResult };

export async function* streamReply(
  userText: string,
  mem: PartnerMemory,
  opts?: { signal?: AbortSignal; thinkMs?: number },
): AsyncGenerator<NeuralEvent> {
  yield { type: "neural", layer: "sense", label: clip(userText, 48) };

  const effects = applyLocalEffects(userText, mem);
  const profile = BAKUGANS[effects.memory.activeId];

  let usedLlm = false;
  try {
    const health = await pingStudio();
    if (health?.llm?.ready) {
      usedLlm = true;
      yield* streamLlmReply(userText, effects, profile, opts?.signal);
      return;
    }
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") throw err;
    usedLlm = false;
  }

  if (!usedLlm) {
    yield { type: "neural", layer: "intend", label: "offline core — local bounce" };
  }
  yield* streamMockReply(userText, mem, opts);
}

async function* streamLlmReply(
  userText: string,
  effects: { memory: PartnerMemory; switchedTo?: BakuganId },
  profile: (typeof BAKUGANS)[BakuganId],
  signal?: AbortSignal,
): AsyncGenerator<NeuralEvent> {
  yield { type: "neural", layer: "intend", label: "llama.cpp · Qwen2.5-3B" };

  let buf = "";
  let emotion: Emotion | null = null;
  let spoken = "";
  let emitted = 0;
  let previewed = false;

  const flushSentences = function* (final: boolean): Generator<NeuralEvent> {
    const sentences = splitSentences(spoken);
    const ready = final ? sentences : sentences.slice(0, -1);
    while (emitted < ready.length) {
      const sentence = ready[emitted]!;
      yield { type: "sentence", sentence, index: emitted };
      yield {
        type: "neural",
        layer: "body",
        label: emitted === 0 ? "bob + glow" : "keep moving",
      };
      emitted += 1;
    }
  };

  try {
    for await (const tok of streamStudioTokens(
      {
        text: userText,
        partnerName: effects.memory.partnerName,
        facts: effects.memory.facts,
        form: effects.memory.forms[effects.memory.activeId],
        character: {
          name: profile.name,
          attribute: profile.attribute,
          personality: profile.personality,
        },
        messages: [{ role: "user", content: userText }],
      },
      signal,
    )) {
      buf += tok;
      if (!emotion) {
        const parsed = parseEmotionPrefix(buf);
        if (parsed.complete) {
          emotion = parsed.emotion;
          spoken = parsed.text;
          yield { type: "neural", layer: "feel", label: `[${emotion}]` };
          yield {
            type: "emotion",
            emotion,
            memory: effects.memory,
            switchedTo: effects.switchedTo,
          };
          yield {
            type: "neural",
            layer: "intend",
            label: intentLabel(emotion, spoken, effects.switchedTo),
          };
        }
        continue;
      }
      const parsed = parseEmotionPrefix(buf);
      spoken = parsed.text;
      if (!previewed && spoken.length > 8) {
        previewed = true;
        yield { type: "preview", willSay: spoken, emotion };
        yield { type: "neural", layer: "speak", label: clip(spoken, 40) };
      }
      yield* flushSentences(false);
    }
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") throw err;
    if (!emotion) {
      yield* streamMockReply(userText, effects.memory, { signal });
      return;
    }
  }

  if (!emotion) {
    yield* streamMockReply(userText, effects.memory, { signal });
    return;
  }

  if (!previewed) {
    yield { type: "preview", willSay: spoken, emotion };
    yield { type: "neural", layer: "speak", label: clip(spoken, 40) };
  }
  yield* flushSentences(true);

  yield {
    type: "done",
    result: {
      tagged: `[${emotion}] ${spoken}`,
      emotion,
      text: spoken,
      memory: effects.memory,
      switchedTo: effects.switchedTo,
    },
  };
}

async function* streamMockReply(
  userText: string,
  mem: PartnerMemory,
  opts?: { signal?: AbortSignal; thinkMs?: number },
): AsyncGenerator<NeuralEvent> {
  const thinkMs = opts?.thinkMs ?? 160 + Math.random() * 140;
  await delay(thinkMs * 0.45, opts?.signal);

  const result = think(userText, mem);

  yield { type: "neural", layer: "feel", label: `[${result.emotion}]` };
  yield {
    type: "emotion",
    emotion: result.emotion,
    memory: result.memory,
    switchedTo: result.switchedTo,
  };
  await delay(50, opts?.signal);

  yield {
    type: "neural",
    layer: "intend",
    label: intentLabel(result.emotion, result.text, result.switchedTo),
  };

  yield { type: "preview", willSay: result.text, emotion: result.emotion };
  yield { type: "neural", layer: "speak", label: clip(result.text, 40) };

  const sentences = splitSentences(result.text);
  for (let i = 0; i < sentences.length; i++) {
    if (opts?.signal?.aborted) throw new DOMException("Aborted", "AbortError");
    await delay(35 + sentences[i]!.length * 4, opts?.signal);
    yield { type: "sentence", sentence: sentences[i]!, index: i };
    yield {
      type: "neural",
      layer: "body",
      label: i === 0 ? "bob + glow" : "keep moving",
    };
  }
  yield { type: "done", result };
}

function clip(s: string, n: number) {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length <= n ? t : `${t.slice(0, n - 1)}…`;
}

function intentLabel(emotion: Emotion, text: string, switched?: BakuganId): string {
  if (switched) return `switch → ${BAKUGANS[switched].name}`;
  if (/\bpop|battle|open|claws\b/i.test(text)) return "actuator: pop-open";
  if (emotion === "sad") return "actuator: droop";
  if (emotion === "fierce") return "actuator: shake";
  if (emotion === "happy" || emotion === "amused") return "actuator: hop";
  if (emotion === "excited") return "actuator: pop + wave";
  return `say · ${emotion}`;
}

function delay(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }
    const t = window.setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(t);
        reject(new DOMException("Aborted", "AbortError"));
      },
      { once: true },
    );
  });
}
