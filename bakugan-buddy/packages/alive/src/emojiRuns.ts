/**
 * Split chat text into emoji graphemes and everything else.
 *
 * Intl.Segmenter keeps a ZWJ sequence, a skin-tone sequence, a flag, and a
 * keycap together as one cluster. The chat UI paints each cluster with an
 * emoji font so a text font cannot steal the joiner and break the glyph.
 */

export type EmojiRun = {
  text: string;
  emoji: boolean;
};

const KEYCAP = /\u20E3/u;
const FLAG = /\p{Regional_Indicator}{2}/u;
const TAG_FLAG = /\u{1F3F4}[\u{E0020}-\u{E007E}]+\u{E007F}/u;
const PICTO = /\p{Extended_Pictographic}/u;

let segmenter: Intl.Segmenter | null = null;

function graphemes(text: string): string[] {
  if (typeof Intl !== "undefined" && typeof Intl.Segmenter === "function") {
    if (!segmenter) segmenter = new Intl.Segmenter("en", { granularity: "grapheme" });
    const out: string[] = [];
    for (const part of segmenter.segment(text)) out.push(part.segment);
    return out;
  }
  return [...text];
}

/** True when the cluster is one emoji, including ZWJ, skin tone, flag, and keycap. */
export function isEmojiCluster(segment: string): boolean {
  if (!segment) return false;
  if (TAG_FLAG.test(segment)) return true;
  if (FLAG.test(segment)) return true;
  if (KEYCAP.test(segment)) return true;
  return PICTO.test(segment);
}

/**
 * Merge neighbouring words, but keep every emoji cluster as its own run so a
 * line can wrap between emoji without cutting a ZWJ sequence in half.
 */
export function splitEmojiRuns(text: string): EmojiRun[] {
  const runs: EmojiRun[] = [];
  for (const cluster of graphemes(String(text ?? ""))) {
    const emoji = isEmojiCluster(cluster);
    const last = runs[runs.length - 1];
    if (!emoji && last && !last.emoji) last.text += cluster;
    else runs.push({ text: cluster, emoji });
  }
  return runs;
}

/** The emoji clusters in order, for lookup and combo reading. */
export function emojiClusters(text: string): string[] {
  const found: string[] = [];
  for (const run of splitEmojiRuns(text)) {
    if (run.emoji) found.push(run.text);
  }
  return found;
}
