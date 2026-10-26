import type { BakuganId, Emotion } from "./bakugans";

export type Form = "sphere" | "battle";

export type ChatMessage = {
  id: string;
  role: "bakugan" | "you";
  bakuganId?: BakuganId;
  text: string;
  emotion?: Emotion;
  at: number;
};
