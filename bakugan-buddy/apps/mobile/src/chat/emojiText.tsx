/**
 * Chat text that keeps emoji sequences whole.
 *
 * React Native Web's default face is the system stack, and that stack includes
 * Arial. Arial draws U+200D as its own character, so a ZWJ family, a skin tone,
 * or a flag falls apart into pieces. Emoji clusters are painted with an emoji
 * font, and the web stylesheet stops the line from breaking inside a cluster.
 *
 * A curated Noto set plays as a sticker instead of the font glyph. Everything
 * else, including ZWJ sequences, stays in the emoji face. Reduced motion
 * keeps the font glyph too.
 */
import { Text, type StyleProp, type TextProps, type TextStyle } from "react-native";
import { splitEmojiRuns } from "../../../../packages/alive/src/emojiRuns.ts";
import { useReducedMotion } from "../ui/useReducedMotion";
import { stickerCodeFor } from "../face/emojiCatalog.ts";
import { spokenText } from "../face/expression.ts";
import { StickerGlyph } from "../face/StickerGlyph";

/** How many Lottie players one bubble will start. */
const STICKERS_PER_BUBBLE = 4;

/** Generic `emoji` first, then the faces macOS, Windows, and Linux actually ship. */
export const EMOJI_FONT_FAMILY =
  'emoji, "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", "Twemoji Mozilla"';

/** Latin stays in Inter; emoji code points resolve in the emoji face before Arial. */
export const CHAT_FONT_FAMILY = `${EMOJI_FONT_FAMILY}, Inter, system-ui, -apple-system, sans-serif`;

const isWeb = typeof document !== "undefined";

export function EmojiText({ children, style }: { children: string; style?: StyleProp<TextStyle> }) {
  const reduce = useReducedMotion();
  const runs = splitEmojiRuns(spokenText(children ?? ""));
  let played = 0;
  return (
    <Text style={style}>
      {runs.map((run, index) => {
        if (!run.emoji) return run.text;
        const code = stickerCodeFor(run.text);
        if (!reduce && code && played < STICKERS_PER_BUBBLE) {
          played += 1;
          return <StickerGlyph key={index} code={code} emoji={run.text} size={22} />;
        }
        return (
          <Text key={index} {...emojiSpanProps()}>
            {run.text}
          </Text>
        );
      })}
    </Text>
  );
}

/**
 * `data-emoji` is a web hook for the stylesheet (nowrap, emoji presentation).
 * The prop is not in the native Text types; the cast keeps it on the DOM node.
 */
function emojiSpanProps(): Partial<TextProps> {
  if (!isWeb) return {};
  return { dataSet: { emoji: "1" }, style: emojiStyle } as Partial<TextProps>;
}

const emojiStyle = {
  fontFamily: EMOJI_FONT_FAMILY,
  fontStyle: "normal" as const,
  fontWeight: "normal" as const,
  letterSpacing: 0,
};
