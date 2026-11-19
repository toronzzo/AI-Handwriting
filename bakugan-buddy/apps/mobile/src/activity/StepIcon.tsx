import Svg, { Circle, Path, Rect } from "react-native-svg";
import type { ActivityIcon } from "../../../../packages/alive/src/activity.ts";
import { theme } from "../theme";

/**
 * The small cobalt line icons beside each step. One 16px box, one stroke
 * width, no fills: globe, file, folder, note, brain, screen, bot and a plain
 * dot for a tool nobody named yet. A failed step gets an outlined "!" instead.
 */
export function StepIcon({ icon, size = 16, tone = theme.accent }: { icon: ActivityIcon; size?: number; tone?: string }) {
  const stroke = { stroke: tone, strokeWidth: 1.6, fill: "none" as const, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  switch (icon) {
    case "globe":
      return (
        <Svg width={size} height={size} viewBox="0 0 16 16">
          <Circle cx={8} cy={8} r={6.2} {...stroke} />
          <Path d="M1.8 8h12.4M8 1.8c1.8 2 2.6 4 2.6 6.2S9.8 12.2 8 14.2C6.2 12.2 5.4 10.2 5.4 8S6.2 3.8 8 1.8z" {...stroke} />
        </Svg>
      );
    case "file":
      return (
        <Svg width={size} height={size} viewBox="0 0 16 16">
          <Path d="M4.2 1.8h5l2.6 2.6v9.8H4.2z" {...stroke} />
          <Path d="M9.2 1.8v2.6h2.6M6 8.4h4M6 10.8h4" {...stroke} />
        </Svg>
      );
    case "folder":
      return (
        <Svg width={size} height={size} viewBox="0 0 16 16">
          <Path d="M1.8 4.2h4.4l1.4 1.6h6.6v7.4H1.8z" {...stroke} />
        </Svg>
      );
    case "note":
      return (
        <Svg width={size} height={size} viewBox="0 0 16 16">
          <Rect x={2.6} y={2.2} width={10.8} height={11.6} rx={1.6} {...stroke} />
          <Path d="M5.4 5.8h5.2M5.4 8.2h5.2M5.4 10.6h3.2" {...stroke} />
        </Svg>
      );
    case "brain":
      return (
        <Svg width={size} height={size} viewBox="0 0 16 16">
          <Path d="M8 2.6a2.2 2.2 0 0 0-2.2 2.2c-1.1.2-2 1.2-2 2.4 0 .7.3 1.3.7 1.7q-.4.5-.4 1.2c0 1.2 1 2.2 2.2 2.2q.5 0 .9-.2c.2.9 1 1.6 1.9 1.6" {...stroke} />
          <Path d="M8 2.6a2.2 2.2 0 0 1 2.2 2.2c1.1.2 2 1.2 2 2.4 0 .7-.3 1.3-.7 1.7q.4.5.4 1.2c0 1.2-1 2.2-2.2 2.2q-.5 0-.9-.2c-.2.9-1 1.6-1.9 1.6" {...stroke} />
        </Svg>
      );
    case "screen":
      return (
        <Svg width={size} height={size} viewBox="0 0 16 16">
          <Rect x={1.6} y={2.6} width={12.8} height={8.6} rx={1.2} {...stroke} />
          <Path d="M5.6 13.4h4.8M8 11.2v2.2" {...stroke} />
        </Svg>
      );
    case "bot":
      return (
        <Svg width={size} height={size} viewBox="0 0 16 16">
          <Rect x={2.8} y={5} width={10.4} height={8} rx={2} {...stroke} />
          <Path d="M8 2.2v2.8M5.8 8.4h.01M10.2 8.4h.01M6.2 10.6h3.6" {...stroke} />
        </Svg>
      );
    default:
      return (
        <Svg width={size} height={size} viewBox="0 0 16 16">
          <Circle cx={8} cy={8} r={2.6} {...stroke} />
        </Svg>
      );
  }
}

/** A failed step: a small outlined "!" in theme.dim, never red. */
export function StepAlert({ size = 16, tone = theme.dim }: { size?: number; tone?: string }) {
  const stroke = { stroke: tone, strokeWidth: 1.6, fill: "none" as const, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  return (
    <Svg width={size} height={size} viewBox="0 0 16 16">
      <Circle cx={8} cy={8} r={6.2} {...stroke} />
      <Path d="M8 4.6v4.2M8 11.2h.01" {...stroke} />
    </Svg>
  );
}
