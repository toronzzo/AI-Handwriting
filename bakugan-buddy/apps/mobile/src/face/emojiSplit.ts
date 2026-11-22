/**
 * Split a chat line into plain text and stickers the app can animate.
 * Emoji outside the curated set stay as text.
 */
import { EMOJI_STICKERS, type EmojiSticker } from "./emojiCatalog.ts";

export type StickerPart =
  | { kind: "text"; value: string }
  | { kind: "sticker"; code: string; emoji: string };

const BY_EMOJI = new Map<string, EmojiSticker>();
for (const sticker of EMOJI_STICKERS) {
  BY_EMOJI.set(sticker.emoji, sticker);
  BY_EMOJI.set(sticker.emoji.replace(/\uFE0F/g, ""), sticker);
}

export function splitStickers(text: string): StickerPart[] {
  const source = text ?? "";
  const parts: StickerPart[] = [];
  let cursor = 0;
  for (const token of source.matchAll(/\p{Extended_Pictographic}\uFE0F?/gu)) {
    const raw = token[0];
    const index = token.index ?? 0;
    const sticker = BY_EMOJI.get(raw) ?? BY_EMOJI.get(raw.replace(/\uFE0F/g, ""));
    if (!sticker) continue;
    if (index > cursor) parts.push({ kind: "text", value: source.slice(cursor, index) });
    parts.push({ kind: "sticker", code: sticker.code, emoji: sticker.emoji });
    cursor = index + raw.length;
  }
  if (cursor < source.length) parts.push({ kind: "text", value: source.slice(cursor) });
  if (parts.length === 0) parts.push({ kind: "text", value: source });
  return parts;
}
