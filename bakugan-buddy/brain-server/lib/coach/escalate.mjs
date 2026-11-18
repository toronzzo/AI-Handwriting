/**
 * Coach escalation: honest "I don't have a skill for that" replies and the
 * ready-to-paste prompts for DeepSeek / Grok Bot. NEVER invents commands:
 * the only commands that ever reach the user come from `Command:` lines in
 * skill files, and this file contains none.
 */
import { redactSecrets } from "./redact.mjs";

export const PAID_PROMPT_MAX = 3000;
export const GROK_TEXT_MAX = 1500;

const OPTIONS_LINE = [
  "Here is what I can do:",
  "1) Ask DeepSeek for steps — I show the cost and a Yes/No card, and you confirm before anything is sent.",
  "2) Ask Grok Bot — I prepare a short text you can copy and paste there yourself.",
  "3) Teach me — tell me the steps once you know them, or say \"save lesson\" when it is solved.",
].join("\n");

/** Honest reply when nothing confident matches or a step keeps failing. */
export function escalateReply({ reason = "no-skill", skillName, stepIndex }) {
  if (reason === "failed") {
    const where = skillName ? ` while on "${skillName}" at step ${stepIndex}` : "";
    return [
      `I am not sure this is going right${where}. I will not make up the next step.`,
      OPTIONS_LINE,
    ].join("\n\n");
  }
  return [
    "I do not have a skill for that yet, and I will not invent commands. I never run anything myself: you do the steps, and I check what you paste.",
    OPTIONS_LINE,
  ].join("\n\n");
}

/** A short, self-contained text the user can paste into Grok Bot. */
export function buildGrokBotText(ctx) {
  const parts = [];
  if (ctx.skillName && ctx.stepTitle) {
    parts.push(`Situation: Preyas coach skill "${ctx.skillName}", step ${ctx.stepIndex}: ${ctx.stepTitle}.`);
  } else if (ctx.topic) {
    parts.push(`Situation: ${ctx.topic}`);
  }
  if (ctx.whatTried) parts.push(`What was tried: ${ctx.whatTried}`);
  if (ctx.lastOutput) parts.push(`Last output: ${ctx.lastOutput}`);
  parts.push("Question: what are the exact next steps, with commands, and what should I check?");
  return redactSecrets(parts.join("\n").replace(/\s+/g, " ")).slice(0, GROK_TEXT_MAX);
}

/** The prompt the paid model receives when the user says Yes. */
export function buildPaidPrompt(ctx) {
  const parts = [];
  if (ctx.skillName && ctx.stepTitle) {
    parts.push(`You are helping a user who is stuck while following a coached routine.`);
    parts.push(`Skill: ${ctx.skillName}. Step ${ctx.stepIndex}: ${ctx.stepTitle}.`);
  } else if (ctx.topic) {
    parts.push(`You are helping a user who asked about: ${ctx.topic}.`);
  } else {
    parts.push("You are helping a user who is stuck.");
  }
  if (ctx.whatTried) parts.push(`What was tried: ${ctx.whatTried}`);
  if (ctx.lastOutput) parts.push(`Last output: ${ctx.lastOutput}`);
  parts.push(
    "Give numbered steps with exact commands, and say plainly when you are unsure instead of guessing.",
  );
  return redactSecrets(parts.join("\n").replace(/\s+/g, " ")).slice(0, PAID_PROMPT_MAX);
}
