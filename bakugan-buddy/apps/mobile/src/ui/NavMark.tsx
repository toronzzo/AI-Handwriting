import Svg, { Path } from "react-native-svg";

/**
 * The five drawn nav glyphs (plus a gear for Settings), each on a 24 px grid
 * with a 1.5 px stroke. They replace the emoji in the Mac rail and the phone
 * bar so the shell reads like the rest of the riso print. Strokes are round,
 * fills are none, and the colour comes from the live palette.
 */

export type NavGlyph = "house" | "speech" | "book" | "ledger" | "brain" | "gear";

const SHAPES: Record<NavGlyph, string[]> = {
  house: [
    "M4 10.5 L12 4.5 L20 10.5",
    "M5.8 9.4 V19.5 H18.2 V9.4",
    "M9.7 19.5 V13.9 H14.3 V19.5",
  ],
  speech: [
    "M7 4 H17 A2.5 2.5 0 0 1 19.5 6.5 V14 A2.5 2.5 0 0 1 17 16.5 H10.2 L5.5 20.4 V16.5 H7 A2.5 2.5 0 0 1 4.5 14 V6.5 A2.5 2.5 0 0 1 7 4 Z",
  ],
  book: [
    "M4.5 5.5 A1.5 1.5 0 0 1 6 4 H9.7 C10.9 4 11.6 4.4 12 5 C12.4 4.4 13.1 4 14.3 4 H18 A1.5 1.5 0 0 1 19.5 5.5 V17.5 A1.5 1.5 0 0 1 18 19 H14.3 C13.1 19 12.4 18.6 12 18 C11.6 18.6 10.9 19 9.7 19 H6 A1.5 1.5 0 0 1 4.5 17.5 Z",
    "M12 5 V18",
  ],
  ledger: [
    "M5 4 H19 V20 H5 Z",
    "M9.7 4 V20",
    "M14.3 4 V20",
    "M5 9.5 H19",
    "M5 14.5 H19",
  ],
  brain: [
    "M12 3.5 C9.2 3.5 6.9 5.4 6.9 8.2 C6.9 10.4 8.1 11.9 9.4 13 C8.1 14.2 7.3 15.9 7.3 17.8 C7.3 19.3 8.3 20.5 9.8 20.5 C11 20.5 12 19.6 12 18.5 C12 19.6 13 20.5 14.2 20.5 C15.7 20.5 16.7 19.3 16.7 17.8 C16.7 15.9 15.9 14.2 14.6 13 C15.9 11.9 17.1 10.4 17.1 8.2 C17.1 5.4 14.8 3.5 12 3.5 Z",
    "M12 8.6 V13.2",
  ],
  gear: [
    "M12 8.6 A3.4 3.4 0 1 1 12 8.7",
    "M12 3.2 V5.4",
    "M12 18.6 V20.8",
    "M3.2 12 H5.4",
    "M18.6 12 H20.8",
    "M5.8 5.8 L7.4 7.4",
    "M16.6 16.6 L18.2 18.2",
    "M5.8 18.2 L7.4 16.6",
    "M16.6 7.4 L18.2 5.8",
  ],
};

/** One drawn glyph. Colour must be a real hex from usePalette, never a var(). */
export function NavMark({
  glyph,
  colour,
  size = 24,
}: {
  glyph: NavGlyph;
  colour: string;
  size?: number;
}) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" accessibilityElementsHidden>
      {SHAPES[glyph].map((d) => (
        <Path
          key={d}
          d={d}
          stroke={colour}
          strokeWidth={1.5}
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        />
      ))}
    </Svg>
  );
}
