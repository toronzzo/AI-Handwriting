/**
 * Coach redaction: strip anything that looks like a secret from text the user
 * pastes, BEFORE it is stored in a session, lesson or log. Pure, no I/O.
 */

/** Replace token-looking strings with ***. Never returns the secret. */
export function redactSecrets(text) {
  let out = String(text ?? "");
  out = out.replace(/sk-[A-Za-z0-9]{8,}/g, "sk-***");
  out = out.replace(/ghp_[A-Za-z0-9]{8,}/g, "ghp_***");
  out = out.replace(/github_pat_[A-Za-z0-9]{8,}/g, "github_pat_***");
  out = out.replace(/AKIA[0-9A-Z]{16}/g, "AKIA***");
  out = out.replace(/Bearer\s+\S+/gi, "Bearer ***");
  // KEY=value / TOKEN: value / PASSWORD=value lines: keep the name, hide the value.
  out = out.replace(
    /^(\s*(?:[A-Za-z_]*(?:KEY|TOKEN|PASSWORD|SECRET)[A-Za-z_]*)\s*[=:]\s*)\S+/gim,
    "$1***",
  );
  return out;
}

/** Snippet kept in sessions/lessons: short and secret-free. */
export function redactedSnippet(text, max = 200) {
  const flat = String(text ?? "").replace(/\s+/g, " ").trim();
  return redactSecrets(flat).slice(0, max);
}
