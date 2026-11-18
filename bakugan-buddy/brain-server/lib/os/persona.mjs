/**
 * The live persona on the Agent drive: <dataDir>/persona/chat-system.txt.
 * The user may edit the file by hand; every revision is recorded in
 * versions.jsonl (append-only) with a history copy. This module never
 * deletes or overwrites a user edit, and never throws.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { PERSONA_MAX_CHARS, PREYAS_CHAT_PERSONA, validatePersona } from "../../../packages/alive/src/persona.ts";

function sha256(text) {
  return crypto.createHash("sha256").update(text, "utf8").digest("hex");
}

function writeAtomic(file, text) {
  const temp = `${file}.tmp`;
  fs.writeFileSync(temp, text);
  fs.renameSync(temp, file);
}

function historyPath(dir, rev) {
  return path.join(dir, "history", `rev-${String(rev).padStart(4, "0")}.txt`);
}

function appendVersion(file, record) {
  fs.appendFileSync(file, JSON.stringify(record) + "\n");
}

/** Version lines as records; torn lines are skipped. */
export function listVersions(dataDir) {
  if (!dataDir) return [];
  const file = path.join(dataDir, "persona", "versions.jsonl");
  if (!fs.existsSync(file)) return [];
  const rows = [];
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      const record = JSON.parse(line);
      if (record && record.v === 1 && typeof record.rev === "number") {
        rows.push({
          v: 1,
          rev: record.rev,
          sha256: String(record.sha256 || ""),
          savedAt: String(record.savedAt || ""),
          source: String(record.source || ""),
          chars: Number(record.chars) || 0,
        });
      }
    } catch {
      /* torn line */
    }
  }
  return rows;
}

/**
 * loadPersona(dataDir, { defaultText, now }) -> { text, rev, sha256, source,
 * warnings, usedDefault, upgradeAvailable, maxChars }.
 * Never throws; a missing or read-only dataDir serves the default with a
 * warning. A live file that fails validatePersona is left untouched and the
 * default is served from memory.
 */
export function loadPersona(dataDir, { defaultText = PREYAS_CHAT_PERSONA, now = () => new Date() } = {}) {
  const fallback = (warnings) => ({
    text: defaultText,
    rev: 1,
    sha256: sha256(defaultText),
    source: "default",
    warnings,
    usedDefault: true,
    upgradeAvailable: false,
    maxChars: PERSONA_MAX_CHARS,
  });

  if (!dataDir) return fallback(["dataDir is not set; serving the repo default"]);
  const dir = path.join(dataDir, "persona");
  const livePath = path.join(dir, "chat-system.txt");
  const versionsPath = path.join(dir, "versions.jsonl");
  try {
    fs.mkdirSync(path.join(dir, "history"), { recursive: true });
  } catch (err) {
    return fallback([`persona folder is not writable (${String(err && err.code ? err.code : err)})`]);
  }

  const defaultSha = sha256(defaultText);
  const versions = listVersions(dataDir);
  const lastRecorded = versions.length ? versions[versions.length - 1] : null;
  const liveText = fs.existsSync(livePath) ? fs.readFileSync(livePath, "utf8") : null;

  // 1. No live file: the default becomes revision 1.
  if (liveText === null) {
    const rev = lastRecorded ? lastRecorded.rev + 1 : 1;
    const record = { v: 1, rev, sha256: defaultSha, savedAt: now().toISOString(), source: "default", chars: defaultText.length };
    try {
      writeAtomic(livePath, defaultText);
      appendVersion(versionsPath, record);
      writeAtomic(historyPath(dir, rev), defaultText);
    } catch {
      return fallback(["persona folder is not writable; serving the repo default"]);
    }
    versions.push(record);
    return {
      text: defaultText,
      rev,
      sha256: defaultSha,
      source: "default",
      warnings: [],
      usedDefault: false,
      upgradeAvailable: false,
      maxChars: PERSONA_MAX_CHARS,
    };
  }

  const liveSha = sha256(liveText);

  // 2. Hand edit: the live file differs from the newest recorded revision.
  if (!lastRecorded || lastRecorded.sha256 !== liveSha) {
    const rev = lastRecorded ? lastRecorded.rev + 1 : 1;
    const record = { v: 1, rev, sha256: liveSha, savedAt: now().toISOString(), source: "user", chars: liveText.length };
    appendVersion(versionsPath, record);
    writeAtomic(historyPath(dir, rev), liveText);
    versions.push(record);
  }

  const newest = versions[versions.length - 1];

  // 3. Invalid live text: serve the default from memory, never touch the file.
  const check = validatePersona(liveText);
  if (!check.ok) {
    return {
      text: defaultText,
      rev: newest.rev,
      sha256: sha256(defaultText),
      source: "default",
      warnings: check.errors.map((error) => `live persona ignored: ${error}`),
      usedDefault: true,
      upgradeAvailable: false,
      maxChars: PERSONA_MAX_CHARS,
    };
  }

  // 4. The repo default changed since the last default revision.
  const lastDefault = [...versions].reverse().find((record) => record.source === "default" || record.source === "default-upgrade");
  if (lastDefault && lastDefault.sha256 !== defaultSha) {
    if (liveSha === lastDefault.sha256) {
      // The live file is still exactly the old default: upgrade it.
      const rev = newest.rev + 1;
      const record = { v: 1, rev, sha256: defaultSha, savedAt: now().toISOString(), source: "default-upgrade", chars: defaultText.length };
      writeAtomic(livePath, defaultText);
      appendVersion(versionsPath, record);
      writeAtomic(historyPath(dir, rev), defaultText);
      versions.push(record);
      return {
        text: defaultText,
        rev,
        sha256: defaultSha,
        source: "default-upgrade",
        warnings: [],
        usedDefault: false,
        upgradeAvailable: false,
        maxChars: PERSONA_MAX_CHARS,
      };
    }
    // The user edited: keep their text and flag the upgrade.
    return {
      text: liveText,
      rev: newest.rev,
      sha256: liveSha,
      source: "user",
      warnings: [],
      usedDefault: false,
      upgradeAvailable: true,
      maxChars: PERSONA_MAX_CHARS,
    };
  }

  return {
    text: liveText,
    rev: newest.rev,
    sha256: liveSha,
    source: newest.source,
    warnings: [],
    usedDefault: false,
    upgradeAvailable: false,
    maxChars: PERSONA_MAX_CHARS,
  };
}
