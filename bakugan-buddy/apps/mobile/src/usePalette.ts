import { useEffect, useState } from "react";
import { paletteFor, type Palette } from "./palette.ts";
import { usePageVisible } from "./ui/usePageVisible.ts";

/**
 * The live palette for SVG drawing. CSS `var(--pz-*)` strings are not reliable
 * inside SVG attributes, so charts read real hex values through this hook.
 * It follows the automatic day/night switch: re-evaluated every 60 s, and the
 * check is skipped while the page is hidden (the palette is re-read as soon
 * as it becomes visible again).
 */
export function usePalette(): Palette {
  const [palette, setPalette] = useState<Palette>(() => paletteFor(new Date()));
  const visible = usePageVisible();

  useEffect(() => {
    if (!visible) return;
    setPalette(paletteFor(new Date()));
    const timer = setInterval(() => setPalette(paletteFor(new Date())), 60_000);
    return () => clearInterval(timer);
  }, [visible]);

  return palette;
}
