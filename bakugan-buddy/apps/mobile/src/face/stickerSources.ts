/**
 * Bundled Noto Lottie files, keyed by codepoint.
 * Kept out of the node tests: those run under strip-types, which does not load JSON.
 */
import type { AnimationObject } from "lottie-react-native";
import grin from "./stickers/1f600.json";
import joy from "./stickers/1f602.json";
import blush from "./stickers/1f60a.json";
import hearts from "./stickers/1f60d.json";
import wow from "./stickers/1f62e.json";
import cry from "./stickers/1f622.json";
import sleep from "./stickers/1f634.json";
import fire from "./stickers/1f525.json";
import thumb from "./stickers/1f44d.json";
import party from "./stickers/1f389.json";
import sparkles from "./stickers/2728.json";
import heart from "./stickers/2764.json";

function asAnimation(value: unknown): AnimationObject {
  return value as AnimationObject;
}

export const STICKER_LOTTIE: Record<string, AnimationObject> = {
  "1f600": asAnimation(grin),
  "1f602": asAnimation(joy),
  "1f60a": asAnimation(blush),
  "1f60d": asAnimation(hearts),
  "1f62e": asAnimation(wow),
  "1f622": asAnimation(cry),
  "1f634": asAnimation(sleep),
  "1f525": asAnimation(fire),
  "1f44d": asAnimation(thumb),
  "1f389": asAnimation(party),
  "2728": asAnimation(sparkles),
  "2764": asAnimation(heart),
};
