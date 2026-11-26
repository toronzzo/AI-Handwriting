/**
 * Original Aquos chameleon face for Preyas.
 *
 * Not a copy of the Bakugan toy: a round water-creature head, a three-lobed
 * fin crest, turret eyes, and a wide mouth. Colours come from the palette
 * (day and night), and the drawing is a flat SVG so it stays light at 60 fps.
 * Reduced motion, or a hidden page, holds the resting pose.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { View } from "react-native";
import Svg, { Ellipse, G, Path } from "react-native-svg";
import { mixHex, withAlpha, type Palette } from "../palette.ts";
import { usePageVisible } from "../ui/usePageVisible";
import { useReducedMotion } from "../ui/useReducedMotion";
import { usePalette } from "../usePalette";
import {
  applyPin,
  EXPRESSION_LABEL,
  readFace,
  type FaceExpression,
  type FacePlayback,
  type FaceRead,
  type FaceSignals,
} from "./expression.ts";
import { blinkAmount, lerpPose, mouthFromEnvelope, poseFor, type FacePose } from "./pose.ts";

const VIEW = 200;

type Colours = {
  disc: string;
  skin: string;
  skinLight: string;
  skinDeep: string;
  fin: string;
  eye: string;
  iris: string;
  pupil: string;
  catch: string;
  lip: string;
  mouth: string;
  tongue: string;
  spot: string;
  brow: string;
  shadow: string;
};

/** Rough relative luminance, so the face can pick a light eye on a dark card. */
function isLight(hex: string): boolean {
  const value = hex.replace("#", "");
  if (!/^[0-9a-fA-F]{6}$/.test(value)) return false;
  const n = parseInt(value, 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return r * 0.2126 + g * 0.7152 + b * 0.0722 > 160;
}

function coloursOf(palette: Palette): Colours {
  const lightCard = isLight(palette.card);
  const lightInk = isLight(palette.text);
  return {
    // Risograph retune: the sky keys are flat paper now, so the face draws
    // from the spot colours instead — a blue body, vermilion fins and lips,
    // ink eyes, cream pupils on the dark print.
    disc: mixHex(palette.stageTop, palette.stageBottom, 0.42),
    skin: palette.blue,
    skinLight: mixHex(palette.blue, palette.cream, 0.5),
    skinDeep: mixHex(palette.blue, palette.ink, 0.45),
    fin: mixHex(palette.vermilion, palette.ochre, 0.28),
    eye: lightCard ? palette.card : palette.onAccent,
    iris: palette.blue,
    pupil: lightInk ? palette.cream : palette.ink,
    catch: palette.onAccent,
    lip: palette.vermilion,
    mouth: palette.ink,
    tongue: palette.vermilion,
    spot: withAlpha(palette.onAccent, lightCard ? 0.78 : 0.55),
    brow: lightInk ? palette.cream : palette.ink,
    shadow: withAlpha(lightInk ? palette.bg : palette.text, 0.16),
  };
}

function mergeSignals(signals: FaceSignals, playback: FacePlayback): FaceSignals {
  const speaking = signals.speaking || playback.playing;
  return {
    ...signals,
    speaking,
    generating: signals.generating && !speaking && !signals.recording,
  };
}

type Frame = { pose: FacePose; blink: number; read: FaceRead };

function stillFrame(signals: FaceSignals, playback: FacePlayback, pin: FaceExpression | null): Frame {
  const read = applyPin(readFace(mergeSignals(signals, playback)), pin);
  return { pose: poseFor(read, 0, null, true), blink: 1, read };
}

export function PreyasFace({
  signals,
  playback,
  size,
  pin = null,
  paused = false,
}: {
  signals: FaceSignals;
  playback: () => FacePlayback;
  size: number;
  pin?: FaceExpression | null;
  paused?: boolean;
}) {
  const palette = usePalette();
  const colours = useMemo(() => coloursOf(palette), [palette]);
  const reduce = useReducedMotion();
  const visible = usePageVisible();
  const animate = !reduce && visible && !paused;
  const signalsRef = useRef(signals);
  const playbackRef = useRef(playback);
  const pinRef = useRef(pin);
  signalsRef.current = signals;
  playbackRef.current = playback;
  pinRef.current = pin;
  const [frame, setFrame] = useState<Frame | null>(null);

  useEffect(() => {
    if (!animate) return;
    let raf = 0;
    let held: FacePose | null = null;
    const loop = (time: number) => {
      const play = playbackRef.current();
      const read = applyPin(readFace(mergeSignals(signalsRef.current, play)), pinRef.current);
      const speaking = read.expression === "talking" && (play.playing || signalsRef.current.speaking);
      const amplitude =
        read.expression === "talking"
          ? speaking
            ? mouthFromEnvelope(play.envelope, play.talkStart, Date.now())
            : null
          : null;
      const target = poseFor(read, time, amplitude, false);
      held = held ? lerpPose(held, target, 0.18, 0.5) : target;
      setFrame({ pose: held, blink: blinkAmount(time, false), read });
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [animate]);

  const shown = animate && frame ? frame : stillFrame(signals, playback(), pin);
  const pose = shown.pose;
  const eye = Math.max(0.04, pose.eyeOpen * shown.blink);
  const label = EXPRESSION_LABEL[shown.read.expression];
  const breath = 1 + pose.breath * 0.02;
  const tilt = pose.tilt * 7;
  const mouth = lips(pose.smile, pose.mouth);
  const lookX = pose.lookX * 5.5;
  const lookY = pose.lookY * 4;

  return (
    <View
      style={{ width: size, height: size }}
      accessibilityRole="image"
      accessibilityLabel={`Preyas, ${label}`}
    >
      <Svg width={size} height={size} viewBox={`0 0 ${VIEW} ${VIEW}`}>
        <Ellipse cx={100} cy={108} rx={92} ry={90} fill={colours.disc} />
        <Ellipse cx={100} cy={176} rx={46} ry={8} fill={colours.shadow} />
        <G transform={`translate(100, 112) rotate(${tilt.toFixed(2)}) scale(${breath.toFixed(3)}) translate(-100, -112)`}>
          <Path
            d="M70 46 C84 28 116 28 130 46 C140 58 146 74 140 78 C128 70 112 66 100 66 C88 66 72 70 60 78 C54 74 60 58 70 46 Z"
            fill={colours.fin}
            transform={`translate(100, 62) scale(${(0.84 + pose.crest * 0.28).toFixed(3)}) translate(-100, -62)`}
          />
          <Path
            d="M48 58 C58 40 78 36 84 52 C88 64 78 74 66 74 C54 74 42 70 48 58 Z"
            fill={colours.fin}
            transform={`translate(66, 58) rotate(${(-16 - pose.crest * 10).toFixed(2)}) scale(${(0.8 + pose.crest * 0.3).toFixed(3)}) translate(-66, -58)`}
          />
          <Path
            d="M152 58 C142 40 122 36 116 52 C112 64 122 74 134 74 C146 74 158 70 152 58 Z"
            fill={colours.fin}
            transform={`translate(134, 58) rotate(${(16 + pose.crest * 10).toFixed(2)}) scale(${(0.8 + pose.crest * 0.3).toFixed(3)}) translate(-134, -58)`}
          />
          <G transform={`translate(46, 116) rotate(${(-22 - pose.fin * 18).toFixed(2)})`}>
            <Ellipse cx={0} cy={0} rx={16} ry={24} fill={colours.skinDeep} />
            <Ellipse cx={2} cy={-2} rx={8} ry={14} fill={colours.fin} />
          </G>
          <G transform={`translate(154, 116) rotate(${(22 + pose.fin * 18).toFixed(2)})`}>
            <Ellipse cx={0} cy={0} rx={16} ry={24} fill={colours.skinDeep} />
            <Ellipse cx={-2} cy={-2} rx={8} ry={14} fill={colours.fin} />
          </G>
          <Path
            d="M100 64 C148 62 170 94 166 122 C162 160 138 184 100 186 C62 184 38 160 34 122 C30 94 52 62 100 64 Z"
            fill={colours.skin}
          />
          <Ellipse cx={100} cy={146} rx={42} ry={24} fill={colours.skinLight} />
          <Ellipse cx={78} cy={96} rx={26} ry={16} fill={withAlpha(colours.skinLight, 0.55)} />
          <Path
            d={`M56 ${88 - pose.brow * 8} Q74 ${78 - pose.brow * 14} 92 ${90 - pose.brow * 4}`}
            stroke={colours.brow}
            strokeWidth={4}
            strokeLinecap="round"
            fill="none"
          />
          <Path
            d={`M144 ${88 - pose.brow * 8} Q126 ${78 - pose.brow * 14} 108 ${90 - pose.brow * 4}`}
            stroke={colours.brow}
            strokeWidth={4}
            strokeLinecap="round"
            fill="none"
          />
          <Eye
            cx={76 + pose.turret * 5}
            cy={114}
            open={eye}
            lookX={lookX}
            lookY={lookY}
            colours={colours}
          />
          <Eye
            cx={124 - pose.turret * 5}
            cy={114}
            open={eye}
            lookX={lookX}
            lookY={lookY}
            colours={colours}
          />
          <Ellipse cx={92} cy={138} rx={3.2} ry={2.2} fill={colours.skinDeep} />
          <Ellipse cx={108} cy={138} rx={3.2} ry={2.2} fill={colours.skinDeep} />
          {mouth.interior ? <Path d={mouth.interior} fill={colours.mouth} /> : null}
          {mouth.tongue ? <Path d={mouth.tongue} fill={colours.tongue} /> : null}
          <Path d={mouth.upper} stroke={colours.lip} strokeWidth={4} strokeLinecap="round" fill="none" />
          {pose.mouth > 0.12 ? (
            <Path d={mouth.lower} stroke={colours.lip} strokeWidth={3.5} strokeLinecap="round" fill="none" />
          ) : null}
          <Spot cx={58} cy={140} r={4.2} blush={pose.blush} fill={colours.spot} />
          <Spot cx={66} cy={150} r={3.2} blush={pose.blush} fill={colours.spot} />
          <Spot cx={54} cy={150} r={2.6} blush={pose.blush} fill={colours.spot} />
          <Spot cx={142} cy={140} r={4.2} blush={pose.blush} fill={colours.spot} />
          <Spot cx={134} cy={150} r={3.2} blush={pose.blush} fill={colours.spot} />
          <Spot cx={146} cy={150} r={2.6} blush={pose.blush} fill={colours.spot} />
        </G>
      </Svg>
    </View>
  );
}

function Eye({
  cx,
  cy,
  open,
  lookX,
  lookY,
  colours,
}: {
  cx: number;
  cy: number;
  open: number;
  lookX: number;
  lookY: number;
  colours: Colours;
}) {
  const lid = Math.max(0.08, Math.min(1, open));
  const px = cx + Math.max(-6, Math.min(6, lookX));
  const py = cy + Math.max(-4, Math.min(4, lookY)) * lid;
  // A real blink is a line. Scaling the whole eye group was unreliable on web.
  if (lid < 0.2) {
    return (
      <Path
        d={`M ${cx - 16} ${cy} Q ${cx} ${cy + 2.5} ${cx + 16} ${cy}`}
        stroke={colours.brow}
        strokeWidth={4}
        strokeLinecap="round"
        fill="none"
      />
    );
  }
  const whiteRy = 19 * lid;
  const irisRy = 10 * lid;
  const pupilRy = 5.4 * lid;
  return (
    <G>
      <Ellipse cx={cx} cy={cy + 1} rx={19} ry={whiteRy + 1.2} fill={colours.skinDeep} />
      <Ellipse cx={cx} cy={cy} rx={17} ry={whiteRy} fill={colours.eye} />
      <Ellipse cx={cx + lookX * 0.28} cy={cy + lookY * 0.2 * lid} rx={9} ry={irisRy} fill={colours.iris} />
      <Ellipse cx={px} cy={py} rx={4.8} ry={pupilRy} fill={colours.pupil} />
      <Ellipse cx={px - 2.1} cy={py - 2.4 * lid} rx={1.8} ry={Math.max(1.1, 1.8 * lid)} fill={colours.catch} />
    </G>
  );
}

function Spot({ cx, cy, r, blush, fill }: { cx: number; cy: number; r: number; blush: number; fill: string }) {
  return <Ellipse cx={cx} cy={cy} rx={r} ry={r * 0.85} fill={fill} opacity={0.28 + blush * 0.55} />;
}

/** Upper lip, lower lip, the dark inside, and a tongue once the jaw is really open. */
function lips(smile: number, open: number): { upper: string; lower: string; interior: string | null; tongue: string | null } {
  const y = 158;
  const lift = smile * 12;
  const bow = smile * 20;
  const left = 72;
  const right = 128;
  const mid = 100;
  const upperY = y - lift;
  const control = y + bow;
  const gap = 3 + Math.max(0, open) * 24;
  const upper = `M ${left} ${upperY} Q ${mid} ${control} ${right} ${upperY}`;
  const lower = `M ${left + 3} ${upperY + 1} Q ${mid} ${control + gap} ${right - 3} ${upperY + 1}`;
  const interior =
    open > 0.08
      ? `M ${left + 8} ${upperY + 1} Q ${mid} ${control + gap * 0.15} ${right - 8} ${upperY + 1} Q ${mid} ${control + gap - 1} ${left + 8} ${upperY + 1} Z`
      : null;
  const tongue =
    open > 0.34
      ? `M ${mid - 10} ${control + gap * 0.45} Q ${mid} ${control + gap - 2} ${mid + 10} ${control + gap * 0.45} Q ${mid} ${control + gap * 0.7} ${mid - 10} ${control + gap * 0.45} Z`
      : null;
  return { upper, lower, interior, tongue };
}
