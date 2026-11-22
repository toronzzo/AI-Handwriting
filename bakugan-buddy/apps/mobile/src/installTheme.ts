/**
 * Web-only installer for the Pajaro theme. It injects one <style id="pz-theme">
 * with the palette variables, the Inter and Oswald variable fonts, the base
 * page colours and the focus ring, then keeps the light/dark attribute and
 * the theme-color meta tag in step with the saved appearance choice. A no-op
 * outside the web.
 *
 * The blocking script in public/index.html sets data-pz before the first
 * paint. This installer repeats that decision once the bundle is up, and
 * again when the choice, the device scheme, or the night window changes.
 */
import { DAY, NIGHT, cssVars } from "./palette.ts";
import { installSky } from "./skyCss.ts";
import {
  detectSystemDark,
  readThemePrefs,
  resolveScheme,
  subscribeThemePrefs,
  THEME_PREFS_KEY,
} from "./themePrefs.ts";

function installTheme(): void {
  if (typeof document === "undefined") return;

  const css = [
    "@font-face{font-family:Inter;font-style:normal;font-display:swap;font-weight:100 900;src:url('/fonts/Inter-var.woff2') format('woff2')}",
    "@font-face{font-family:Oswald;font-style:normal;font-display:swap;font-weight:200 700;src:url('/fonts/Oswald-var.woff2') format('woff2')}",
    `:root{${cssVars(DAY)};color-scheme:light}`,
    `html[data-pz="night"]{${cssVars(NIGHT)};color-scheme:dark}`,
    "html,body{background:var(--pz-bg);color:var(--pz-onSky);font-family:Inter,system-ui,-apple-system,sans-serif}",
    ":focus-visible{outline:3px solid var(--pz-onSky);outline-offset:2px}",
  ].join("\n");

  let el = document.getElementById("pz-theme") as HTMLStyleElement | null;
  if (!el) {
    el = document.createElement("style");
    el.id = "pz-theme";
    document.head.appendChild(el);
  }
  el.textContent = css;

  // The sky gradient and clouds live in their own style + a static div.
  installSky();

  function apply(): void {
    const night =
      resolveScheme(readThemePrefs(), { now: new Date(), systemDark: detectSystemDark() }) === "night";
    document.documentElement.dataset.pz = night ? "night" : "day";
    document.documentElement.style.colorScheme = night ? "dark" : "light";

    const skyTop = (night ? NIGHT : DAY).skyTop;
    let meta = document.querySelector('meta[name="theme-color"]') as HTMLMetaElement | null;
    if (!meta) {
      meta = document.createElement("meta");
      meta.name = "theme-color";
      document.head.appendChild(meta);
    }
    meta.content = skyTop;
  }

  apply();
  subscribeThemePrefs(apply);
  const mq = window.matchMedia("(prefers-color-scheme: dark)");
  mq.addEventListener("change", apply);
  window.addEventListener("storage", (event) => {
    if (event.key === THEME_PREFS_KEY) apply();
  });
  setInterval(() => {
    if (document.hidden) return;
    apply();
  }, 60_000);
  document.addEventListener("visibilitychange", apply);
}

installTheme();
