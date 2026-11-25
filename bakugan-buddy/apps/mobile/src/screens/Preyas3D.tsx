/**
 * The 3D ball, loaded on demand (slice 8A).
 *
 * The real ball (PreyasHero.tsx) pulls in react-three-fiber, three and the GLB
 * loader. With the 8-bit look switched ON none of the 3D code must be on the
 * page at all. So the 3D screen is imported only through the dynamic
 * import() below, and React.lazy runs it only when Preyas3D is actually
 * rendered - which happens only while the switch is OFF.
 *
 * A static test (src/bits/lazy3d.test.ts, marked "3d-code") checks that no
 * other file imports the 3D screen.
 *
 * The fallback is a plain coloured box of the same size, so switching ON
 * (module dropped, sprite drawn) and switching OFF (module fetched) never
 * jumps the layout.
 */
import { lazy, Suspense } from "react";
import { StyleSheet, View } from "react-native";
import { theme } from "../theme";
import { BODY_LABEL, type PreyasBodyState } from "../face/bodyState.ts";
import type { PreyasClip } from "./preyasClips";

export type Preyas3DProps = {
  /** What he is really doing: rest, listening, thinking or speaking. */
  state: PreyasBodyState;
  short?: boolean;
  fill?: boolean;
  /** A small square instead of the tall hero: the avatar in the face panel. */
  size?: number;
  /** One of the ball's own clips (idle, open, closed, happy). */
  clip?: PreyasClip;
  /** Full-screen stage: no pedestal, camera fitted to the whole viewport. */
  bare?: boolean;
};

const HERO_MIN = theme.space.xl * 7;
const SHORT = theme.space.xl * 5;
const TALL = theme.space.xl * 8;

const LazyHero = lazy(async () => {
  const module = await import("./PreyasHero"); // 3d-code
  return { default: module.PreyasHero };
});

export function Preyas3D(props: Preyas3DProps) {
  const box = props.size ? { width: props.size, height: props.size } : undefined;
  return (
    <Suspense
      fallback={
        <View
          style={[
            styles.placeholder,
            box,
            props.size ? undefined : props.fill ? styles.fill : props.short ? styles.short : styles.tall,
          ]}
          accessibilityRole="image"
          accessibilityLabel={`Loading: ${BODY_LABEL[props.state]}`}
        />
      }
    >
      <LazyHero {...props} />
    </Suspense>
  );
}

const styles = StyleSheet.create({
  placeholder: {
    width: "100%",
    borderRadius: theme.radius.md,
    backgroundColor: theme.track,
  },
  fill: { flex: 1, minHeight: HERO_MIN },
  short: { height: SHORT },
  tall: { height: TALL },
});
