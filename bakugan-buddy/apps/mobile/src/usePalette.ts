import { useEffect, useState } from "react";
import { activePalette, subscribeThemePrefs, THEME_PREFS_KEY, type Palette } from "./themePrefs.ts";
import { usePageVisible } from "./ui/usePageVisible.ts";

/**
 * The live palette for SVG drawing. CSS `var(--pz-*)` strings are not reliable
 * inside SVG attributes, so charts read real hex values through this hook.
 * It follows the saved appearance choice: the device scheme, the optional
 * night window, and a re-check every 60 s. The check is skipped while the
 * page is hidden and runs again as soon as the page is visible.
 */
export function usePalette(): Palette {
  const [palette, setPalette] = useState<Palette>(() => activePalette(new Date()));
  const visible = usePageVisible();

  useEffect(() => {
    if (!visible) return;
    const pull = () => setPalette(activePalette(new Date()));
    pull();
    const timer = setInterval(pull, 60_000);
    const stop = subscribeThemePrefs(pull);
    const mq = typeof matchMedia === "function" ? matchMedia("(prefers-color-scheme: dark)") : null;
    mq?.addEventListener?.("change", pull);
    const onStorage = (event: StorageEvent) => {
      if (event.key === THEME_PREFS_KEY) pull();
    };
    const win = typeof window !== "undefined" ? window : null;
    win?.addEventListener("storage", onStorage);
    let appearance: { remove: () => void } | null = null;
    if (typeof navigator !== "undefined" && navigator.product === "ReactNative") {
      try {
        const rn = require("react-native") as {
          Appearance?: { addChangeListener?: (cb: () => void) => { remove: () => void } };
        };
        appearance = rn.Appearance?.addChangeListener?.(pull) ?? null;
      } catch {
        appearance = null;
      }
    }
    return () => {
      clearInterval(timer);
      stop();
      mq?.removeEventListener?.("change", pull);
      win?.removeEventListener("storage", onStorage);
      appearance?.remove();
    };
  }, [visible]);

  return palette;
}
