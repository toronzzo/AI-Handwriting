import { useEffect, useRef, useState } from "react";
import { Image, Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";
import Svg, { Circle, Path } from "react-native-svg";
import { uploadArt, useArt, type SlotId } from "../art/slots.ts";
import { mixHex } from "../palette.ts";
import { theme } from "../theme";
import { usePalette } from "../usePalette";

/**
 * The placeholder gradient, drawn as thin bands because the app has no
 * gradient package: theme.cardSoft at the top down to the slotPlaceholder
 * colour at the bottom. The two ends come from the live palette, so the
 * placeholder follows day and night like everything else.
 */
const BANDS = 12;

/** How long "Couldn't save the photo" stays on screen after a failed upload. */
const ERROR_MS = 4_000;

/** The quiet picture glyph shown while a slot has no picture. */
function PictureIcon({ colour }: { colour: string }) {
  return (
    <Svg width={34} height={34} viewBox="0 0 34 34" accessibilityElementsHidden>
      <Path
        d="M5 8.5 A3.5 3.5 0 0 1 8.5 5 H25.5 A3.5 3.5 0 0 1 29 8.5 V25.5 A3.5 3.5 0 0 1 25.5 29 H8.5 A3.5 3.5 0 0 1 5 25.5 Z"
        stroke={colour}
        strokeWidth={2}
        fill="none"
      />
      <Circle cx={12.5} cy={12.5} r={2.6} stroke={colour} strokeWidth={2} fill="none" />
      <Path
        d="M6.5 24 L14 16.5 L20 22.5 L24 18.5 L28 22.5"
        stroke={colour}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </Svg>
  );
}

/** A short human name for a slot, used in the button's screen-reader label. */
const SLOT_NAMES: Record<SlotId, string> = {
  hero: "hero",
  bg: "background",
  house: "house",
  car: "car",
  study: "study",
  "bakugan-buddy": "Bakugan Buddy",
  studio: "studio",
};

/** How a change of picture ended: saved, or the picture was not taken. */
export type PhotoOutcome = "saved" | "failed";

/**
 * The "Change photo" button and the picker behind it (slice 10b).
 *
 * A press opens the system image picker with images only and no editing. The
 * picked picture is read as bytes and POSTed to the brain, which saves it and
 * moves the old one to art/old/. While that happens the button says "Saving…"
 * and ignores more presses; when it ends, `onSaved` is told which way. The
 * rest of the screen is never covered or blocked: this is a small button in a
 * corner, not a dialog.
 */
export function useChangePhoto(slot: SlotId, onSaved: (outcome: PhotoOutcome) => void) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const busyRef = useRef(false);
  const alive = useRef(true);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  const change = async () => {
    if (busyRef.current) return;
    if (timer.current) clearTimeout(timer.current);
    setError(false);
    let picked: { canceled: boolean; assets?: { uri: string }[] | null } | null = null;
    try {
      const ImagePicker = await import("expo-image-picker");
      picked = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        allowsEditing: false,
        quality: 0.9,
      });
    } catch {
      // No picker on this platform, or the user changed their mind: no fuss.
      return;
    }
    if (!picked || picked.canceled) return;
    const uri = picked.assets?.[0]?.uri;
    if (!uri) return;
    busyRef.current = true;
    setBusy(true);
    let outcome: PhotoOutcome = "failed";
    try {
      await uploadArt(slot, uri);
      outcome = "saved";
    } catch {
      // A plain "it did not work": the brain's own words are not shown.
      outcome = "failed";
    }
    busyRef.current = false;
    if (!alive.current) return;
    setBusy(false);
    onSaved(outcome);
    if (outcome === "saved") return;
    setError(true);
    timer.current = setTimeout(() => {
      if (alive.current) setError(false);
    }, ERROR_MS);
  };

  return { busy, error, change };
}

/**
 * The same picker the slot's button uses, and the same success and failure
 * handling, but driven by any control the caller renders itself (the
 * Settings panel's "Change background" button).
 */
export function usePhotoSwitcher(slot: SlotId, onSaved: (outcome: PhotoOutcome) => void) {
  return useChangePhoto(slot, onSaved);
}

/**
 * One of the user's pictures, in a rounded box. With an image it fills the box
 * (cover, decorative: it says nothing a screen reader needs). Without one, a
 * soft cardSoft-to-slotPlaceholder gradient with a small line picture glyph in
 * theme.faint. A missing picture is normal, never an error, so no danger colour
 * is used here; only the failed-save note appears, and it is plain dim text.
 *
 * With `editable` the user can change the picture from inside the app.
 */
export function ArtSlot({
  slot,
  aspectRatio,
  radius = 12,
  style,
  editable = false,
  editorCorner = "bottom",
}: {
  slot: SlotId;
  aspectRatio?: number;
  radius?: number;
  style?: StyleProp<ViewStyle>;
  /** Show the small "Change photo" button in a corner of the picture. */
  editable?: boolean;
  /**
   * Which corner the button sits in. The hero plate moves it to the top: the
   * printed level number owns the bottom-left, and the two used to collide so
   * the level read as half hidden.
   */
  editorCorner?: "bottom" | "top";
}) {
  const art = useArt(slot);
  const palette = usePalette();
  // A saved picture loads straight away; a failure shows a short note below.
  const { busy, error, change } = useChangePhoto(slot, (outcome) => {
    if (outcome === "saved") art.reload();
  });

  const box: StyleProp<ViewStyle> = [
    styles.box,
    { borderRadius: radius },
    aspectRatio ? { aspectRatio } : null,
    style,
  ];

  const hasPicture = art.status === "ready" && Boolean(art.url);

  const bands: string[] = [];
  for (let i = 0; i < BANDS; i++) {
    bands.push(mixHex(palette.cardSoft, palette.slotPlaceholder, i / (BANDS - 1)));
  }

  return (
    /**
     * box-none without a picture: the gradient is decoration, so taps over it
     * reach what is underneath (FIX-2, where Preyas is drawn on top of the
     * empty hero slot). With a picture the box behaves as before.
     */
    <View style={box} pointerEvents={hasPicture ? "auto" : "box-none"}>
      {hasPicture ? (
        <Image source={{ uri: art.url }} style={styles.image} resizeMode="cover" alt="" />
      ) : (
        <View style={styles.placeholder} pointerEvents="none">
          {bands.map((colour, index) => (
            <View
              key={index}
              style={[styles.band, { backgroundColor: colour, height: `${100 / BANDS}%` }]}
            />
          ))}
          <View style={styles.icon}>
            <PictureIcon colour={palette.faint} />
          </View>
        </View>
      )}

      {editable ? (
        /**
         * FIX-2: the button layer is box-none and lifted with zIndex, so the
         * "Change photo" button stays visible and tappable even when something
         * (the pixel Preyas, or the 3D ball's transparent box) is drawn over
         * the picture, while the empty areas keep letting taps through.
         */
        <View style={editorCorner === "top" ? styles.editorTop : styles.editor} pointerEvents="box-none">
          {error ? (
            <View style={styles.errorNote} pointerEvents="none">
              <Text style={styles.errorText}>Couldn't save the photo</Text>
            </View>
          ) : null}
          <Pressable
            onPress={() => void change()}
            disabled={busy}
            style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}
            accessibilityRole="button"
            accessibilityLabel={`Change ${SLOT_NAMES[slot]} photo`}
            accessibilityState={{ disabled: busy }}
          >
            <Text style={styles.buttonText} numberOfLines={1}>
              {busy ? "Saving…" : "Change photo"}
            </Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    width: "100%",
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: theme.accentLine,
  },
  image: { width: "100%", height: "100%" },
  placeholder: { flex: 1, width: "100%", alignItems: "center", justifyContent: "center" },
  band: { width: "100%" },
  icon: { position: "absolute", alignItems: "center", justifyContent: "center" },
  /**
   * The button sits in the bottom-left corner; nothing else moves for it. The
   * zIndex keeps it above Preyas when he is drawn over the empty placeholder
   * (LevelCard, FIX-2); the layer itself is box-none so taps elsewhere pass
   * through to him.
   */
  editor: {
    position: "absolute",
    left: 8,
    bottom: 8,
    right: 8,
    alignItems: "flex-start",
    gap: 6,
    zIndex: 3,
  },
  /** The same button layer, pinned to the top-left instead of the bottom. */
  editorTop: {
    position: "absolute",
    left: 8,
    top: 8,
    right: 8,
    alignItems: "flex-start",
    gap: 6,
    zIndex: 3,
  },
  button: {
    minHeight: 36,
    minWidth: 36,
    paddingHorizontal: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: theme.accentLine,
    backgroundColor: theme.card,
    alignItems: "center",
    justifyContent: "center",
    zIndex: 3,
  },
  buttonPressed: { opacity: 0.85 },
  buttonText: { color: theme.text, fontSize: 13, fontWeight: "600" },
  errorNote: {
    maxWidth: 220,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
    backgroundColor: theme.cardSoft,
    borderWidth: 1,
    borderColor: theme.accentLine,
  },
  errorText: { color: theme.dim, fontSize: 12.5 },
});
