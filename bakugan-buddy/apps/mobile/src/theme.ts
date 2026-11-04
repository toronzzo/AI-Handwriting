/**
 * One calm theme for the whole app: a dark room with a teal Preyas accent.
 * 8px spacing grid, one type scale. Every screen reads from here.
 */
export const theme = {
  bg: "#07100d",
  card: "#0e1a16",
  cardSoft: "#0c1613",
  accent: "#43d9ad",
  accentDim: "rgba(67,217,173,0.55)",
  accentSoft: "rgba(67,217,173,0.14)",
  accentLine: "rgba(67,217,173,0.28)",
  text: "#eaf7f1",
  dim: "#93aca2",
  faint: "#6d857c",
  danger: "#ff8a8a",
  good: "#3dde8a",
  space: { xs: 4, sm: 8, md: 16, lg: 24, xl: 32 },
  type: { label: 11, caption: 12, body: 14, input: 16, title: 18, hero: 24 },
  radius: { sm: 10, md: 14, lg: 20 },
} as const;

export type Theme = typeof theme;
