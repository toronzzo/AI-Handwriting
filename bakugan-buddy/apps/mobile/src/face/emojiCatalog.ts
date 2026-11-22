/**
 * The animated stickers bundled with the app.
 * Artwork is Google's Animated Noto Emoji (CC BY 4.0); see stickers/NOTICE.md.
 * The list itself is data only, so tests can run without parsing the Lottie files.
 */
export type EmojiSticker = {
  code: string;
  emoji: string;
  name: string;
};

export const EMOJI_STICKERS: readonly EmojiSticker[] = [
  { code: "1f600", emoji: "😀", name: "grin" },
  { code: "1f602", emoji: "😂", name: "joy" },
  { code: "1f60a", emoji: "😊", name: "blush" },
  { code: "1f60d", emoji: "😍", name: "heart eyes" },
  { code: "1f62e", emoji: "😮", name: "surprised" },
  { code: "1f622", emoji: "😢", name: "cry" },
  { code: "1f634", emoji: "😴", name: "sleepy" },
  { code: "1f525", emoji: "🔥", name: "fire" },
  { code: "1f44d", emoji: "👍", name: "thumbs up" },
  { code: "1f389", emoji: "🎉", name: "party" },
  { code: "2728", emoji: "✨", name: "sparkles" },
  { code: "2764", emoji: "❤️", name: "heart" },
];

export function stickerByCode(code: string): EmojiSticker | null {
  return EMOJI_STICKERS.find((sticker) => sticker.code === code) ?? null;
}

const CODE_BY_EMOJI = new Map<string, string>();
for (const sticker of EMOJI_STICKERS) {
  CODE_BY_EMOJI.set(sticker.emoji, sticker.code);
  CODE_BY_EMOJI.set(sticker.emoji.replace(/\uFE0F/g, ""), sticker.code);
}

/** Codepoint for a single emoji cluster, or null when it is not in the animated set. */
export function stickerCodeFor(cluster: string): string | null {
  return CODE_BY_EMOJI.get(cluster) ?? CODE_BY_EMOJI.get(cluster.replace(/\uFE0F/g, "")) ?? null;
}
