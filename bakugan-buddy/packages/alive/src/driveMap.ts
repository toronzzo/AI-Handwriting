/**
 * The "drive map": a small, pure index of what lives on the Agent drive.
 *
 * The scanner (brain-server/lib/driveMap.mjs) builds the map object from the
 * disk; everything here is pure so both the server and the tests can share it:
 * deciding whether a message is a drive question, pulling the "where is …"
 * target out of it, searching the map by name, and rendering the short prompt
 * snippet that lets the local model answer from the map instead of the web.
 */

export type DriveFolder = {
  name: string;
  path: string;
  size: number;
  files: number;
  modified: number;
  examples: string[];
};

export type DriveModel = {
  name: string;
  path: string;
  size: number;
  type: string;
};

export type DriveMap = {
  root: string;
  scanned: number;
  totalSize: number;
  totalFiles: number;
  folders: DriveFolder[];
  models: DriveModel[];
};

/** "scan my drive" / "scan the drive" — a refresh request, not a question. */
export function isScanDriveCommand(raw: string): boolean {
  return /^\s*(?:please\s+)?scan\s+(?:my\s+|the\s+)?drive\b/i.test(String(raw ?? ""));
}

/** "how much space is left" / "how much free space" / "disk space". */
export function isSpaceQuestion(raw: string): boolean {
  return /\b(?:how much (?:space|free space|disk space)|free space|space (?:is\s+)?left|space (?:do|does) i have|disk space)\b/i.test(
    String(raw ?? ""),
  );
}

/** Pull the target out of "where is <name>" / "where are <name>". */
export function whereIsQuery(raw: string): string | null {
  const text = String(raw ?? "").trim();
  const match = text.match(/^where\s+(?:is|are|do\s+i\s+find|can\s+i\s+find)\s+(.+?)\s*[?.!]*$/i);
  if (!match) return null;
  const name = match[1].replace(/^(?:my|the|our|a|an)\s+/i, "").replace(/[?.!]+$/, "").trim();
  return name || null;
}

const DRIVE_WORDS = /\b(?:my\s+|the\s+|agent\s+)?drive\b|\bdatasets?\b|\bfolders?\b|\bfiles?\b|\bmodels?\b/i;

/**
 * Is this a question about the drive map (what is on the drive, where a file
 * is, how much space is left)? Pure and conservative: it must name a drive
 * topic or be one of the explicit commands, and it must actually ask.
 */
export function isDriveQuestion(raw: string): boolean {
  const text = String(raw ?? "").trim().toLowerCase();
  if (!text) return false;
  if (isScanDriveCommand(text)) return true;
  if (isSpaceQuestion(text)) return true;
  if (whereIsQuery(text)) return true;
  if (/what'?s? (?:on|in) (?:my |the |agent )?drive\b/i.test(text)) return true;
  if (!DRIVE_WORDS.test(text)) return false;
  return /\b(what|where|which|how many|how much|list|show|scan|find|have|located|size|space)\b/i.test(text);
}

export type DriveMatch = {
  name: string;
  path: string;
  size: number;
  type: string;
};

/** Search folder names, example files and models for a name (case-insensitive). */
export function searchDriveMap(map: DriveMap, query: string, limit = 10): DriveMatch[] {
  const q = String(query ?? "").toLowerCase().trim();
  if (!q || !map) return [];
  const out: DriveMatch[] = [];
  const seen = new Set<string>();
  const push = (match: DriveMatch) => {
    const key = `${match.path}/${match.name}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(match);
  };
  for (const folder of map.folders || []) {
    if (folder.name.toLowerCase().includes(q) || folder.path.toLowerCase().includes(q)) {
      push({ name: folder.name, path: folder.path, size: folder.size, type: "folder" });
    }
    for (const example of folder.examples || []) {
      if (example.toLowerCase().includes(q)) {
        push({ name: example, path: folder.path, size: 0, type: "file" });
      }
    }
  }
  for (const model of map.models || []) {
    if (model.name.toLowerCase().includes(q) || model.path.toLowerCase().includes(q)) {
      push({ name: model.name, path: model.path, size: model.size, type: model.type || "model" });
    }
  }
  return out.slice(0, limit);
}

function formatBytes(bytes: number): string {
  const n = Number(bytes) || 0;
  if (n >= 1024 * 1024 * 1024) return `${(n / 1024 / 1024 / 1024).toFixed(1)} GB`;
  if (n >= 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  if (n >= 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${n} B`;
}

/**
 * The short summary that goes into the prompt for a drive question, kept well
 * under ~1500 tokens. `focus` is a "where is …" target; when given, the name
 * matches are listed first.
 */
export function driveMapPrompt(map: DriveMap, focus?: string): string {
  const lines = [
    "A map of the Agent drive, from its index. Answer from this; do not invent files, folders or models.",
    `Scanned ${new Date(map.scanned).toISOString()}; ${map.totalFiles} files, ${formatBytes(map.totalSize)} total.`,
  ];
  if (focus) {
    const matches = searchDriveMap(map, focus);
    if (matches.length) {
      lines.push(`Places matching "${focus}":`);
      for (const match of matches) {
        lines.push(`- ${match.path}/${match.name} (${match.type}, ${formatBytes(match.size)})`);
      }
    } else {
      lines.push(`Nothing on the drive is named like "${focus}".`);
    }
    lines.push("");
  }
  lines.push("Folders:");
  for (const folder of map.folders || []) {
    const examples = (folder.examples || []).slice(0, 3).join(", ");
    lines.push(`- ${folder.path}: ${folder.files} files, ${formatBytes(folder.size)}${examples ? `, e.g. ${examples}` : ""}`);
  }
  if (map.models?.length) {
    lines.push("Models:");
    for (const model of map.models) {
      lines.push(`- ${model.path}/${model.name} (${model.type || "model"}, ${formatBytes(model.size)})`);
    }
  }
  return lines.join("\n");
}
