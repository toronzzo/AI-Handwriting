/**
 * Rebuild the compact emoji dataset from official Unicode sources.
 *
 *   node bakugan-buddy/brain-server/lib/emoji/build.mjs
 *
 * Downloads nothing at chat time. This script is the only thing that talks to
 * the network, and only when a maintainer regenerates the file.
 *
 * Sources (Unicode License v3, see ./LICENSE):
 *   emoji-test.txt          Unicode 18  https://www.unicode.org/Public/emoji/latest/emoji-test.txt
 *   CLDR 49 annotations     en.xml + annotationsDerived/en.xml
 *                           https://github.com/unicode-org/cldr/tree/release-49/common
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, "emoji-data.json");

const EMOJI_TEST_URL = "https://www.unicode.org/Public/emoji/latest/emoji-test.txt";
const CLDR_URL = "https://raw.githubusercontent.com/unicode-org/cldr/release-49/common/annotations/en.xml";
const CLDR_DERIVED_URL = "https://raw.githubusercontent.com/unicode-org/cldr/release-49/common/annotationsDerived/en.xml";

const GROUP = {
  "Smileys & Emotion": "s",
  "People & Body": "p",
  "Animals & Nature": "a",
  "Food & Drink": "f",
  "Travel & Places": "t",
  Activities: "c",
  Objects: "o",
  Symbols: "y",
  Flags: "g",
};

/** Whole-token or stem hits against the short name and CLDR keywords. */
const MOOD_WORDS = {
  happy: ["smile", "grin", "joy", "happy", "laugh", "love", "heart", "kiss", "party", "celebrat", "blush", "hug", "sun", "flower", "music", "dance", "sparkle"],
  excited: ["party", "tada", "celebrat", "fire", "rocket", "spark", "zap", "lightning", "boom", "trophy", "medal", "confetti", "balloon", "explode", "star-struck", "100"],
  angry: ["angry", "rage", "mad", "pout", "swear", "anger", "frown", "steam", "unamused", "furious", "annoyed", "bomb"],
  sad: ["cry", "sad", "tear", "sob", "disappoint", "broken", "pleading", "weary", "tired", "wilt", "lonely", "hurt"],
  surprised: ["astonish", "shock", "wow", "scream", "flushed", "dizzy", "surprise", "gasp", "exploding head"],
  thinking: ["think", "monocle", "ponder", "idea", "light bulb", "curious"],
  listening: ["ear", "hear", "listen", "speech", "microphone", "speak"],
  battle: ["sword", "shield", "bow", "fist", "punch", "dagger", "axe", "boxing", "martial", "skull", "dragon", "crossed swords", "collision", "biceps", "muscle", "flex"],
  neutral: ["thumbs up", "ok hand", "check mark", "waving", "slight smile", "neutral face"],
};

const SKIN_CP = new Set(["1F3FB", "1F3FC", "1F3FD", "1F3FE", "1F3FF"]);
const SKIN_CHARS = /[\u{1F3FB}-\u{1F3FF}]/gu;
const VS = /[\uFE0E\uFE0F]/g;

function norm(emoji) {
  return String(emoji).replace(VS, "").replace(SKIN_CHARS, "");
}

function unescapeXml(value) {
  return String(value)
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

async function fetchText(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} -> ${res.status}`);
  return res.text();
}

function parseAnnotations(xml) {
  const keywords = new Map();
  const names = new Map();
  const re = /<annotation cp="([^"]+)"([^>]*)>([^<]*)<\/annotation>/g;
  for (const match of xml.matchAll(re)) {
    const key = norm(unescapeXml(match[1]));
    if (!key) continue;
    const body = unescapeXml(match[3]).trim();
    const tts = /\btype="tts"/.test(match[2]);
    if (tts) {
      if (!names.has(key)) names.set(key, body);
      continue;
    }
    const list = keywords.get(key) || [];
    for (const part of body.split("|")) {
      const word = part.trim().toLowerCase();
      if (word && !list.includes(word)) list.push(word);
    }
    keywords.set(key, list);
  }
  return { keywords, names };
}

function parseEmojiTest(text) {
  let group = "";
  const bases = [];
  const seen = new Set();
  let fullyQualified = 0;
  const skinOnly = new Map();
  for (const line of text.split("\n")) {
    if (line.startsWith("# group:")) {
      group = line.slice("# group:".length).trim();
      continue;
    }
    if (!line.includes("; fully-qualified")) continue;
    fullyQualified += 1;
    const hash = line.indexOf("#");
    const comment = line.slice(hash + 1).trim();
    const match = comment.match(/^(\S+)\s+E[\d.]+\s+(.+)$/);
    if (!match) continue;
    const emoji = match[1];
    const name = match[2].trim();
    const cps = line.slice(0, line.indexOf(";")).trim().split(/\s+/);
    const key = norm(emoji);
    if (cps.some((cp) => SKIN_CP.has(cp))) {
      // Two-tone handshakes have no skinless fully-qualified row. Keep one
      // base so lookup can strip the tones and still name the sequence.
      if (!skinOnly.has(key)) {
        skinOnly.set(key, {
          emoji: key,
          name: name.replace(/:\s*.*$/, "").trim() || name,
          group: GROUP[group] || "o",
          key,
        });
      }
      continue;
    }
    if (seen.has(key)) continue;
    seen.add(key);
    bases.push({ emoji, name, group: GROUP[group] || "o", key });
  }
  for (const [key, entry] of skinOnly) {
    if (seen.has(key)) continue;
    seen.add(key);
    bases.push(entry);
  }
  return { bases, fullyQualified, seen };
}

function tokensOf(text) {
  return String(text)
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length >= 3);
}

function moodsFor(name, keywords, group) {
  if (group === "g") return "";
  const phrase = `${name} ${keywords.join(" ")}`.toLowerCase();
  const tokens = tokensOf(phrase);
  const found = [];
  for (const [mood, words] of Object.entries(MOOD_WORDS)) {
    const hit = words.some((word) => {
      if (word.includes(" ")) return phrase.includes(word);
      return tokens.some((token) => token === word || (word.length >= 5 && token.startsWith(word)));
    });
    if (hit) found.push(mood);
  }
  return found.join(",");
}

function keywordsFor(entry, tables) {
  const fromCldr = tables.keywords.get(entry.key) || [];
  const fromName = entry.name
    .replace(/^flag:\s*/i, "")
    .split(/[^A-Za-z0-9]+/)
    .map((word) => word.toLowerCase())
    .filter((word) => word.length >= 3 && word !== "flag");
  const out = [];
  for (const word of [...fromCldr, ...fromName]) {
    if (!word || word === entry.name.toLowerCase()) continue;
    if (word.length > 40) continue;
    if (!out.includes(word)) out.push(word);
    if (out.length >= 12) break;
  }
  return out.join("|");
}

function assertCoverage(parsed) {
  if (parsed.fullyQualified < 3700) {
    throw new Error(`expected >= 3700 fully-qualified emoji, got ${parsed.fullyQualified}`);
  }
  if (parsed.bases.length < 1500) {
    throw new Error(`expected >= 1500 base emoji, got ${parsed.bases.length}`);
  }
}

async function main() {
  const [emojiTest, annotations, derived] = await Promise.all([
    fetchText(EMOJI_TEST_URL),
    fetchText(CLDR_URL),
    fetchText(CLDR_DERIVED_URL),
  ]);
  const version = emojiTest.match(/^# Version:\s*(\S+)/m);
  if (!version || version[1] !== "18.0") {
    throw new Error(`emoji-test.txt is ${version ? version[1] : "unknown"}, expected 18.0`);
  }
  const parsed = parseEmojiTest(emojiTest);
  const mainAnn = parseAnnotations(annotations);
  const derivedAnn = parseAnnotations(derived);
  const tables = {
    keywords: new Map([...derivedAnn.keywords, ...mainAnn.keywords]),
    names: new Map([...derivedAnn.names, ...mainAnn.names]),
  };
  // Main annotations win over derived when both exist (spread order above is derived then main).
  for (const [key, list] of mainAnn.keywords) tables.keywords.set(key, list);
  for (const [key, name] of mainAnn.names) tables.names.set(key, name);

  const rows = parsed.bases.map((entry) => {
    const name = tables.names.get(entry.key) || entry.name;
    const keywords = keywordsFor({ ...entry, name }, tables);
    const keywordList = keywords ? keywords.split("|") : [];
    return [entry.emoji, name, keywords, entry.group, moodsFor(name, keywordList, entry.group)];
  });
  assertCoverage(parsed);
  const body = {
    unicode: "18.0",
    cldr: "49",
    license: "Unicode-3.0",
    fullyQualified: parsed.fullyQualified,
    bases: rows.length,
    rows,
  };
  fs.writeFileSync(OUT, JSON.stringify(body));
  const size = fs.statSync(OUT).size;
  console.log(`wrote ${rows.length} bases covering ${parsed.fullyQualified} fully-qualified emoji (${size} bytes)`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
