/**
 * B6 computer control: the hard deny list. ONE file with the explicit rules
 * as exported constants and a pure checkDenied(proposal, ctx) -> verdict.
 * ctx carries the frontmost app name and window title from the CURRENT
 * observation, never from the model. Nothing here ever executes anything.
 */
import { redactSecrets } from "../coach/redact.mjs";

/** Apps that are never controlled, whatever the goal says. */
export const NEVER_APPS = new Set([
  "terminal",
  "iterm2",
  "warp",
  "system settings",
  "system preferences",
  "keychain access",
  "passwords",
  "1password",
  "bitwarden",
  "activity monitor",
  "script editor",
  "automator",
]);

/** Key combos that are never pressed. Normalized: lowercase, "+" between keys. */
export const FORBIDDEN_COMBOS = new Set([
  "cmd+q",
  "cmd+shift+q",
  "ctrl+cmd+q",
  "cmd+opt+esc",
  "cmd+delete",
  "cmd+shift+delete",
  "cmd+opt+shift+q",
]);

/** Window titles or URLs that look like money or accounts. */
export const MONEY_TITLE =
  /\b(bank|paypal|stripe|checkout|payment|wallet|revolut|wise|kaspi|bunq|sign\s*in|password)\b/i;

/** Click labels that are denied outright. */
export const DENIED_CLICK_LABELS =
  /\b(delete|erase|format|empty\s*trash|pay|buy|purchase|place\s*order|transfer|send\s*money)\b/i;

/** Click labels allowed only as "ask" with an extra careful line. */
export const CAREFUL_CLICK_LABELS = /\b(send|submit|sign\s*out|log\s*out|install)\b/i;

/** The extra line shown when a careful label is proposed. */
export const CAREFUL_WARNING = "Careful: this can't be undone.";

/** Typed text is capped and must never contain these. */
export const MAX_TYPED_CHARS = 300;

export const FORBIDDEN_TEXT = [
  { name: "sudo", test: /\bsudo\b/i },
  { name: "rm -", test: /\brm\s+-/i },
  { name: "curl | sh", test: /\bcurl\b[^|\n]*\|[^|\n]*\bsh\b/i },
  { name: "git push --force", test: /\bgit\s+push\s+(?:--force|-f)\b/i },
  { name: "chmod -R", test: /\bchmod\s+(?:-R|--recursive)\b/i },
];

function normalizeCombo(combo) {
  return String(combo || "")
    .toLowerCase()
    .trim()
    .split(/[\s,]+/)
    .join("+");
}

function normalizeApp(app) {
  return String(app || "")
    .trim()
    .toLowerCase()
    .replace(/\.app$/i, "");
}

/**
 * checkDenied(proposal, ctx) -> { denied, rule, why, warn? }.
 * proposal: { action: "click"|"type"|"key"|"done"|"ask", target?, text?,
 * combo?, why? }. ctx: { app, title, url? } from the CURRENT observation.
 * "done" and "ask" are not computer actions and are never denied here.
 */
export function checkDenied(proposal, ctx = {}) {
  const action = String(proposal?.action || "");
  const app = normalizeApp(ctx?.app);
  const title = String(ctx?.title || "");
  const url = String(ctx?.url || "");

  if (app && NEVER_APPS.has(app)) {
    return { denied: true, rule: "app", why: `${app} is never controlled` };
  }
  if (MONEY_TITLE.test(title) || MONEY_TITLE.test(url)) {
    return { denied: true, rule: "money", why: "this window looks like money or an account" };
  }

  if (action === "key") {
    const combo = normalizeCombo(proposal.combo);
    if (FORBIDDEN_COMBOS.has(combo)) {
      return { denied: true, rule: "combo", why: `the key combo "${combo}" is never pressed` };
    }
    const parts = combo.split("+").filter(Boolean);
    if (parts.includes("return") || parts.includes("enter")) {
      if (parts.length !== 1) {
        return { denied: true, rule: "combo", why: "return and enter are separate actions, never combined" };
      }
    }
  }

  if (action === "type") {
    const text = String(proposal.text ?? "");
    if (text.length > MAX_TYPED_CHARS) {
      return { denied: true, rule: "text-length", why: `typed text is longer than ${MAX_TYPED_CHARS} characters` };
    }
    if (/[\r\n]/.test(text)) {
      return { denied: true, rule: "text-newline", why: "typed text can not contain a newline; return is its own action" };
    }
    for (const rule of FORBIDDEN_TEXT) {
      if (rule.test.test(text)) {
        return { denied: true, rule: "text", why: `typed text contains "${rule.name}", which is never typed` };
      }
    }
    if (redactSecrets(text) !== text) {
      return { denied: true, rule: "secret", why: "typed text looks like a key or a token" };
    }
  }

  if (action === "click") {
    // The model never gives coordinates: a click names an element id.
    if (proposal.x !== undefined || proposal.y !== undefined || proposal.coordinates !== undefined) {
      return { denied: true, rule: "coordinates", why: "the model may never give coordinates" };
    }
    const label = String(proposal.targetLabel ?? proposal.target ?? "");
    if (DENIED_CLICK_LABELS.test(label)) {
      return { denied: true, rule: "click-label", why: `clicking "${label.trim()}" is never allowed` };
    }
    if (CAREFUL_CLICK_LABELS.test(label)) {
      return { denied: false, rule: "careful-label", why: CAREFUL_WARNING, warn: CAREFUL_WARNING };
    }
  }

  if (!["click", "type", "key", "done", "ask"].includes(action)) {
    return { denied: true, rule: "unknown-action", why: `unknown computer action "${action}"` };
  }

  return { denied: false };
}
