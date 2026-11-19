import { useEffect, useState } from "react";
import { paletteFor, type Palette } from "./palette.ts";

/**
 * The live palette for SVG drawing. CSS `var(--pz-*)` strings are not reliable
 * inside SVG attributes, so charts read real hex values through this hook.
 * It follows the automatic day/night switch: re-evaluated every 60 s, and
 * again when a hidden tab becomes visible (the check is skipped while hidden).
 */
export function usePalette(): Palette {
  const [palette, setPalette] = useState<Palette>(() => paletteFor(new Date()));

  useEffect(() => {
    const check = () => {
      if (typeof document !== "undefined" && document.hidden) return;
      setPalette(paletteFor(new Date()));
    };
    const timer = setInterval(check, 60_000);
    const onVisible = () => {
      if (typeof document !== "undefined" && !document.hidden) check();
    };
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", onVisible);
    }
    return () => {
      clearInterval(timer);
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", onVisible);
      }
    };
  }, []);

  return palette;
}
