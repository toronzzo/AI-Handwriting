/**
 * A reply, rendered instead of printed.
 *
 * The chat used to drop raw ** and ` into the bubble, which read as broken.
 * This draws the handful of blocks a local model actually writes: paragraphs,
 * three heading levels, bullets, numbers, fenced code and inline emphasis.
 * Text runs go through EmojiText, so emoji and stickers behave as before.
 */
import { useMemo } from "react";
import { Linking, StyleSheet, Text, View } from "react-native";
import { theme } from "../theme.ts";
import { EmojiText } from "./emojiText.tsx";
import { parseMarkdown, type MdInline } from "./md.ts";

function openLink(href: string): void {
  try {
    if (typeof window !== "undefined" && window.open) {
      window.open(href, "_blank", "noopener");
      return;
    }
  } catch {
    /* fall through to the native opener */
  }
  void Linking.openURL(href).catch(() => {});
}

function Inlines({ inlines }: { inlines: MdInline[] }) {
  return (
    <>
      {inlines.map((inline, index) => {
        if (inline.kind === "text") return <EmojiText key={index}>{inline.text}</EmojiText>;
        if (inline.kind === "bold") {
          return (
            <Text key={index} style={styles.bold}>
              {inline.text}
            </Text>
          );
        }
        if (inline.kind === "italic") {
          return (
            <Text key={index} style={styles.italic}>
              {inline.text}
            </Text>
          );
        }
        if (inline.kind === "code") {
          return (
            <Text key={index} style={styles.inlineCode}>
              {inline.text}
            </Text>
          );
        }
        return (
          <Text
            key={index}
            style={styles.link}
            onPress={() => openLink(inline.href)}
            accessibilityRole="link"
            accessibilityLabel={inline.text}
          >
            {inline.text}
          </Text>
        );
      })}
    </>
  );
}

export function Markdown({ text }: { text: string }) {
  const blocks = useMemo(() => parseMarkdown(text), [text]);
  return (
    <View style={styles.wrap}>
      {blocks.map((block, index) => {
        if (block.kind === "code") {
          return (
            <View key={index} style={styles.codeBlock}>
              <Text style={styles.codeText} selectable>
                {block.text}
              </Text>
            </View>
          );
        }
        if (block.kind === "h") {
          return (
            <Text
              key={index}
              style={[styles.heading, block.level === 1 ? styles.h1 : block.level === 2 ? styles.h2 : styles.h3]}
            >
              <Inlines inlines={block.inlines} />
            </Text>
          );
        }
        if (block.kind === "ul" || block.kind === "ol") {
          return (
            <View key={index} style={styles.list}>
              {block.items.map((item, row) => (
                <View key={row} style={styles.row}>
                  <Text style={styles.marker}>{block.kind === "ul" ? "•" : String(row + 1) + "."}</Text>
                  <Text style={styles.itemText}>
                    <Inlines inlines={item} />
                  </Text>
                </View>
              ))}
            </View>
          );
        }
        return (
          <Text key={index} style={styles.paragraph}>
            <Inlines inlines={block.inlines} />
          </Text>
        );
      })}
    </View>
  );
}

const MONO = "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";

const styles = StyleSheet.create({
  wrap: { gap: theme.space.xs },
  paragraph: { color: theme.text, fontSize: theme.type.body, lineHeight: 21 },
  heading: { color: theme.text, fontWeight: "700", fontFamily: theme.font.display },
  h1: { fontSize: theme.type.title },
  h2: { fontSize: theme.type.input },
  h3: { fontSize: theme.type.body },
  bold: { fontWeight: "700" },
  italic: { fontStyle: "italic" },
  inlineCode: {
    fontFamily: MONO,
    fontSize: theme.type.caption,
    color: theme.text,
    backgroundColor: theme.cardSoft,
  },
  link: { color: theme.accentText, textDecorationLine: "underline" },
  codeBlock: {
    backgroundColor: theme.cardSoft,
    borderWidth: 1,
    borderColor: theme.accentLine,
    borderRadius: theme.radius.sm,
    padding: theme.space.sm,
  },
  codeText: { fontFamily: MONO, fontSize: theme.type.caption, color: theme.text },
  list: { gap: theme.space.xs / 2 },
  row: { flexDirection: "row", alignItems: "flex-start", gap: theme.space.xs },
  marker: { color: theme.dim, fontSize: theme.type.body, lineHeight: 21, minWidth: 14 },
  itemText: { flex: 1, color: theme.text, fontSize: theme.type.body, lineHeight: 21 },
});
