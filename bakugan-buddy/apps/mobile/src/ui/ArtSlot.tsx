import { StyleSheet, View, type StyleProp, type ViewStyle, Image } from "react-native";
import Svg, { Circle, Path } from "react-native-svg";
import { useArt, type SlotId } from "../art/slots.ts";
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

/**
 * One of the user's pictures, in a rounded box. With an image it fills the box
 * (cover, decorative: it says nothing a screen reader needs). Without one, a
 * soft cardSoft-to-slotPlaceholder gradient with a small line picture glyph in
 * theme.faint. A missing picture is normal, never an error, so no danger colour.
 */
export function ArtSlot({
  slot,
  aspectRatio,
  radius = 12,
  style,
}: {
  slot: SlotId;
  aspectRatio?: number;
  radius?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const art = useArt(slot);
  const palette = usePalette();

  const box: StyleProp<ViewStyle> = [
    styles.box,
    { borderRadius: radius },
    aspectRatio ? { aspectRatio } : null,
    style,
  ];

  if (art.status === "ready" && art.url) {
    return (
      <View style={box} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <Image source={{ uri: art.url }} style={styles.image} resizeMode="cover" alt="" />
      </View>
    );
  }

  const bands: string[] = [];
  for (let i = 0; i < BANDS; i++) {
    bands.push(mixHex(palette.cardSoft, palette.slotPlaceholder, i / (BANDS - 1)));
  }

  return (
    <View style={box} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {bands.map((colour, index) => (
        <View
          key={index}
          style={[styles.band, { backgroundColor: colour, height: `${100 / BANDS}%` }]}
          pointerEvents="none"
        />
      ))}
      <View style={styles.icon} pointerEvents="none">
        <PictureIcon colour={palette.faint} />
      </View>
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
  band: { width: "100%" },
  icon: { position: "absolute", alignItems: "center", justifyContent: "center" },
});
