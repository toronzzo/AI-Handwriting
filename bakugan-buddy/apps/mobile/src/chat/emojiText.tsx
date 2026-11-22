/**
 * Chat text that keeps emoji sequences whole.
 *
 * React Native Web's default face is the system stack, and that stack includes
 * Arial. Arial draws U+200D as its own character, so a ZWJ family, a skin tone,
 * or a flag falls apart into pieces. Emoji clusters are painted with an emoji
 * font, and the web stylesheet stops the line from breaking inside a cluster.
 */
import { Text, type StyleProp, type TextProps, type TextStyle } from "react-native";
import { splitEmojiRuns } from "../../../../packages/alive/src/emojiRuns.ts";

/** Generic `emoji` first, then the faces macOS, Windows, and Linux actually ship. */
export const EMOJI_FONT_FAMILY =
  'emoji, "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", "Twemoji Mozilla"';

/** Latin stays in Inter; emoji code points resolve in the emoji face before Arial. */
export const CHAT_FONT_FAMILY = `${EMOJI_FONT_FAMILY}, Inter, system-ui, -apple-system, sans-serif`;

const isWeb = typeof document !== "undefined";

export function EmojiText({ children, style }: { children: string; style?: StyleProp<TextStyle> }) {
  const runs = splitEmojiRuns(children);
  return (
    <Text style={style}>
      {runs.map((run, index) =>
        run.emoji ? (
          <Text key={index} {...emojiSpanProps()}>
            {run.text}
          </Text>
        ) : (
          run.text
        ),
      )}
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
