/**
 * Coach step rendering: plain text, one step per reply. Commands are printed
 * ONLY from the skill's own `Command:` lines, character for character.
 * Nothing a model writes ever becomes a command.
 */

function placeholdersIn(step) {
  const names = new Set();
  for (const field of [step.do, step.why, step.check, ...step.commands]) {
    for (const match of String(field ?? "").matchAll(/<([a-z0-9-]+)>/gi)) names.add(match[1]);
  }
  return [...names].sort();
}

/**
 * renderStep(skill, stepIndex, { short }) -> text.
 * stepIndex is 1-based. `short` drops the Why line (for learned skills).
 */
export function renderStep(skill, stepIndex, { short = false } = {}) {
  const step = skill.steps[stepIndex - 1];
  if (!step) return "Coach: I lost track of the step. Say \"stop\" and start again.";
  const lines = [`Step ${stepIndex} of ${skill.steps.length}: ${step.title}`];
  const placeholder = placeholdersIn(step);

  if (step.danger) {
    lines.push("Careful: read the Check first.", `Check: ${step.check}`);
  }
  lines.push(`Do: ${step.do}`);
  if (!short && step.why) {
    lines.push(`Why: ${step.why}`);
  }
  for (const command of step.commands) lines.push(`Command: ${command}`);
  if (!step.danger) lines.push(`Check: ${step.check}`);
  if (placeholder.length) lines.push(`Replace <${placeholder.join("> and <")}> with the real value.`);
  lines.push(step.ack ? "Say done when finished." : "Paste what you see here.");
  return lines.join("\n");
}

/** The short "why" reply for the current step. */
export function renderWhy(skill, stepIndex) {
  const step = skill.steps[stepIndex - 1];
  if (!step || !step.why) return "Coach: this step has no separate why. Just follow the Check.";
  return `Why: ${step.why}`;
}
