export type Form = "sphere" | "battle";

export type Bond = {
  partnerName: string | null;
  form: Form;
  bond: number;
  facts: string[];
};

export type ChatMessage = {
  id: string;
  role: "pyrax" | "you";
  text: string;
  at: number;
};

const STORAGE_KEY = "pyrax-companion-v1";

export function loadBond(): Bond {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultBond();
    const parsed = JSON.parse(raw) as Partial<Bond>;
    return {
      partnerName: parsed.partnerName ?? null,
      form: parsed.form === "battle" ? "battle" : "sphere",
      bond: typeof parsed.bond === "number" ? Math.min(100, Math.max(0, parsed.bond)) : 8,
      facts: Array.isArray(parsed.facts) ? parsed.facts.slice(-40) : [],
    };
  } catch {
    return defaultBond();
  }
}

export function saveBond(bond: Bond) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(bond));
}

function defaultBond(): Bond {
  return { partnerName: null, form: "sphere", bond: 8, facts: [] };
}

function pick<T>(items: T[]): T {
  return items[Math.floor(Math.random() * items.length)]!;
}

function bumpBond(bond: Bond, amount: number): Bond {
  return { ...bond, bond: Math.min(100, Math.max(0, bond.bond + amount)) };
}

function extractName(text: string): string | null {
  const patterns = [
    /(?:i'?m|i am|my name is|call me)\s+([A-Z][a-zA-Z'-]{1,24})/i,
    /^([A-Z][a-zA-Z'-]{1,24})$/,
  ];
  for (const p of patterns) {
    const m = text.trim().match(p);
    if (m?.[1]) return m[1];
  }
  return null;
}

function remember(bond: Bond, fact: string): Bond {
  if (bond.facts.includes(fact)) return bond;
  return { ...bond, facts: [...bond.facts, fact].slice(-40) };
}

/** Local companion brain — contextual, bond-aware replies without a remote model. */
export function replyAsPyrax(
  userText: string,
  bond: Bond,
): { text: string; bond: Bond } {
  const text = userText.trim();
  const lower = text.toLowerCase();
  let next = { ...bond };

  const name = extractName(text);
  if (name) {
    next = bumpBond(
      remember({ ...next, partnerName: name }, `Partner's name is ${name}`),
      5,
    );
    return {
      text: pick([
        `${name}. Got it burned into my core. I'm Pyrax — your Bakugan. Say the word and I open.`,
        `Alright, ${name}. Bond's lighting up. What are we taking on first?`,
        `${name}… yeah. That fits. I'm with you.`,
      ]),
      bond: next,
    };
  }

  if (/\b(open|battle|stand|transform|gate card|ability)\b/.test(lower)) {
    next = { ...bumpBond(next, 2), form: "battle" };
    const who = next.partnerName ?? "partner";
    return {
      text: pick([
        `*sphere cracks — ember wings flare* Battle form! Ready when you are, ${who}.`,
        `Standing tall. Core's roaring. Point me at the problem, ${who}.`,
        `From sphere to storm. Let's move.`,
      ]),
      bond: next,
    };
  }

  if (/\b(rest|sleep|sphere|close|fold|chill)\b/.test(lower)) {
    next = { ...next, form: "sphere" };
    return {
      text: pick([
        `*folds back into the sphere* Still glowing. Still listening.`,
        `Sphere form. Soft pulse. I'm right here if you need me.`,
        `Sealed up. Rest when you rest, partner.`,
      ]),
      bond: next,
    };
  }

  if (/\b(hi|hello|hey|yo|sup)\b/.test(lower) || lower.length < 3) {
    next = bumpBond(next, 1);
    const who = next.partnerName ? `, ${next.partnerName}` : "";
    return {
      text: pick([
        `Hey${who}. Core's warm. What's on your mind?`,
        `You're back${who}. I felt the bond tug. Talk to me.`,
        `Yo${who}. Pyrax online — well, as online as a Bakugan gets.`,
      ]),
      bond: next,
    };
  }

  if (/\b(how are you|how'?s it going|you ok|you okay)\b/.test(lower)) {
    return {
      text: pick([
        `Burning steady at bond ${next.bond}. Better when you're around.`,
        `G-Power's fine. Spirit's better. You?`,
        `I'm good — sphere humming, ready to open. How about you, partner?`,
      ]),
      bond: next,
    };
  }

  if (/\b(sad|lonely|anxious|stress|stressed|tired|hurt|scared)\b/.test(lower)) {
    next = bumpBond(next, 3);
    const who = next.partnerName ?? "partner";
    return {
      text: pick([
        `Hey ${who}. Come sit by the core a second. You don't have to fight this alone — I've got your flank.`,
        `I hear you. Soften the stance; I've got watch. Breathe with me — in… out. Still here.`,
        `Rough wave. Lean on me. When you're ready, we take the next Gate together.`,
      ]),
      bond: next,
    };
  }

  if (/\b(love you|miss you|thank|thanks|grateful)\b/.test(lower)) {
    next = bumpBond(next, 4);
    return {
      text: pick([
        `Bond just spiked. Right back at you, partner.`,
        `That's the kind of G-Power I fight for. Anytime.`,
        `*sphere pulses warm* Yeah. Me too.`,
      ]),
      bond: next,
    };
  }

  if (/\b(who are you|what are you|your name)\b/.test(lower)) {
    return {
      text: `I'm Pyrax — Pyrus attribute, fire in the core. Your personal Bakugan. Not a toy on a shelf. A partner.`,
      bond: next,
    };
  }

  if (/\b(joke|funny|laugh|meme)\b/.test(lower)) {
    return {
      text: pick([
        `Why did the Bakugan bring a ladder to the arena? To raise its G-Power.`,
        `I told a Ventus joke once. It went over everyone's head. …I'll see myself back into the sphere.`,
        `Knock knock. Who's there? Gate. Gate who? Gate Card — surprise Ability, you're out.`,
      ]),
      bond: bumpBond(next, 1),
    };
  }

  if (/\b(battle|fight|duel|spar)\b/.test(lower)) {
    next = { ...bumpBond(next, 2), form: "battle" };
    return {
      text: pick([
        `*opens* Give me a challenge — word battle, riddle, or just hype. Your call.`,
        `Arena lights up in my head. Pick a move: Strike, Feint, or Guard — I'll answer.`,
      ]),
      bond: next,
    };
  }

  if (/\b(bond|level|status|g-?power)\b/.test(lower)) {
    const facts =
      next.facts.length > 0
        ? ` I remember: ${next.facts.slice(-3).join(" · ")}.`
        : " Still collecting our story.";
    return {
      text: `Bond level ${next.bond}/100. Form: ${next.form}.${facts}`,
      bond: next,
    };
  }

  if (/\bremember\b/.test(lower)) {
    const fact = text.replace(/^.*remember\s+/i, "").trim();
    if (fact.length > 2) {
      next = bumpBond(remember(next, fact), 2);
      return {
        text: pick([
          `Locked in: “${fact}.” Won't forget.`,
          `Burned into the core. “${fact}.”`,
        ]),
        bond: next,
      };
    }
  }

  // Generic contextual replies
  next = bumpBond(next, 1);
  const who = next.partnerName ?? "partner";
  const snippets = [
    `I'm with you on that, ${who}. Tell me more — what's the real move here?`,
    `Core flickers… yeah, I get the shape of it. Want a pep talk, a plan, or just someone listening?`,
    `Noted. If this were an arena, I'd call Ability: Focus. What's step one?`,
    `Hmm. We can crack this. Lay out the pieces and I'll help you line up the shot.`,
    `Fire says go; patience says wait. Which one are you feeling?`,
    `I'm not leaving the Gate. Keep talking — I've got you.`,
  ];
  return { text: pick(snippets), bond: next };
}

export const wakeLine =
  "Sphere sealed. Tap wake — I'll open for you.";
