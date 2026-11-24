/**
 * Which of the 3D ball's own clips matches a face expression.
 *
 * The ball in assets/models/preyas_ball.glb is rigged and ships five clips
 * (idle, open, close, closed, happy). The face vocabulary is richer than that,
 * so the quiet expressions share "idle" and the low ones close the shell. The
 * caption above the ball still names the exact expression the chat asked for.
 */
import type { PreyasClip } from "../screens/preyasClips.ts";
import type { FaceExpression } from "./expression.ts";

export function clipForExpression(expression: FaceExpression): PreyasClip {
  switch (expression) {
    case "talking":
    case "excited":
    case "surprised":
      return "open";
    case "happy":
      return "happy";
    case "sad":
    case "sleepy":
      return "closed";
    default:
      return "idle";
  }
}
