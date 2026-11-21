/**
 * Settings > About Preyas. Shows the live capability list the brain actually
 * checked, the services it can see, and the newest changelog lines. If a thing
 * is not in this list, Preyas is expected to say "I can't do that yet."
 */
import { useCallback, useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { theme } from "../theme";
import { brainFetch } from "../room/brain/token";
import { readProbe } from "../room/brain/probeJson";
import { probeThrownError } from "./probe";
import {
  ABOUT_GROUPS,
  aboutHeadline,
  aboutItems,
  changelogPreview,
  normalizeCapabilities,
  serviceDots,
  type CapabilitiesView,
} from "./about";
type Props = { brainUrl: string; refreshSignal?: number };

const REQUEST_TIMEOUT_MS = 6000;

export function AboutPreyas({ brainUrl, refreshSignal = 0 }: Props) {
  const [view, setView] = useState<CapabilitiesView | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!brainUrl) {
      setError("Connect to the Mac first.");
      setLoading(false);
      return;
    }
    setLoading(true);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const res = await brainFetch(brainUrl.replace(/\/$/, "") + "/v1/capabilities", { signal: controller.signal });
      const read = await readProbe<unknown>("About Preyas", res);
      if (!read.ok) {
        setError(read.error);
        return;
      }
      setView(normalizeCapabilities(read.body));
      setError("");
    } catch (caught) {
      setError(probeThrownError("About Preyas", caught));
    } finally {
      clearTimeout(timer);
      setLoading(false);
    }
  }, [brainUrl]);

  useEffect(() => {
    void load();
  }, [load, refreshSignal]);

  const services = view ? serviceDots(view) : [];
  const notes = view ? changelogPreview(view) : [];

  return (
    <View style={styles.card}>
      <View style={styles.head}>
        <Text style={styles.kicker}>ABOUT PREYAS</Text>
        <Pressable onPress={() => void load()} accessibilityRole="button" accessibilityLabel="Refresh what Preyas can do" hitSlop={8}>
          <Text style={styles.refresh}>{loading ? "Checking…" : "Refresh"}</Text>
        </Pressable>
      </View>

      {view ? <Text style={styles.headline}>{aboutHeadline(view)}</Text> : null}
      {error ? <Text style={styles.warn}>{error}</Text> : null}
      {!view && loading ? <Text style={styles.dim}>Asking the Mac what I can do…</Text> : null}

      {view
        ? ABOUT_GROUPS.map((group) => {
            const items = aboutItems(view, group.key);
            if (!items.length) return null;
            return (
              <View key={group.key} style={styles.group}>
                <Text style={styles.groupTitle}>{group.title}</Text>
                {items.map((item) => (
                  <View key={item.id} style={styles.itemRow}>
                    <View style={styles.dotOn} />
                    <View style={styles.itemCopy}>
                      <Text style={styles.itemLabel}>
                        {item.label}
                        {item.current ? " · running" : ""}
                      </Text>
                      {item.detail ? <Text style={styles.dim}>{item.detail}</Text> : null}
                    </View>
                  </View>
                ))}
              </View>
            );
          })
        : null}

      {services.length ? (
        <View style={styles.group}>
          <Text style={styles.groupTitle}>On the Mac right now</Text>
          <View style={styles.serviceWrap}>
            {services.map((service) => (
              <View key={service.label} style={styles.servicePill}>
                <View style={service.running ? styles.dotOn : styles.dotOff} />
                <Text style={styles.serviceText}>{service.label}</Text>
              </View>
            ))}
          </View>
        </View>
      ) : null}

      {notes.length ? (
        <View style={styles.group}>
          <Text style={styles.groupTitle}>What's new</Text>
          {notes.map((note, index) => (
            <Text key={note.date + index} style={styles.note}>
              <Text style={styles.noteDate}>{note.date}</Text>
              {"  "}
              {note.text}
            </Text>
          ))}
        </View>
      ) : null}

      <Text style={styles.dim}>
        This list is checked when the brain starts and again when you open this card. If something is not
        listed, I will say "I can't do that yet."
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: theme.card,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.accentLine,
    padding: theme.space.md,
    gap: theme.space.sm,
  },
  head: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  kicker: { color: theme.accent, fontSize: theme.type.label, letterSpacing: 1.2, fontWeight: "700" },
  refresh: { color: theme.accent, fontSize: theme.type.caption },
  headline: { color: theme.text, fontSize: theme.type.body, fontWeight: "600" },
  warn: { color: theme.danger, fontSize: theme.type.caption },
  dim: { color: theme.dim, fontSize: theme.type.caption, lineHeight: 18 },
  group: { gap: theme.space.xs, marginTop: theme.space.xs },
  groupTitle: { color: theme.text, fontSize: theme.type.caption, fontWeight: "700" },
  itemRow: { flexDirection: "row", alignItems: "flex-start", gap: theme.space.sm, paddingVertical: 2 },
  itemCopy: { flex: 1, gap: 1 },
  itemLabel: { color: theme.text, fontSize: theme.type.caption },
  dotOn: { width: theme.space.sm, height: theme.space.sm, borderRadius: theme.space.xs, backgroundColor: theme.good, marginTop: 5 },
  dotOff: { width: theme.space.sm, height: theme.space.sm, borderRadius: theme.space.xs, backgroundColor: theme.off, marginTop: 5 },
  serviceWrap: { flexDirection: "row", flexWrap: "wrap", gap: theme.space.sm },
  servicePill: { flexDirection: "row", alignItems: "center", gap: 6 },
  serviceText: { color: theme.dim, fontSize: theme.type.caption },
  note: { color: theme.text, fontSize: theme.type.caption, lineHeight: 19 },
  noteDate: { color: theme.accent, fontSize: theme.type.caption },
});
