/**
 * Web-only installer for the Pajaro theme. It injects one <style id="pz-theme">
 * with the palette variables, the Inter and Oswald variable fonts, the base
 * page colours and the focus ring, then keeps the day/night attribute and the
 * theme-color meta tag in step with the local clock. A no-op outside the web.
 */
import { DAY, NIGHT, cssVars, isNight } from "./palette.ts";
import { installSky } from "./skyCss.ts";

function installTheme(): void {
  if (typeof document === "undefined") return;

  const css = [
    "@font-face{font-family:Inter;font-style:normal;font-display:swap;font-weight:100 900;src:url('/fonts/Inter-var.woff2') format('woff2')}",
    "@font-face{font-family:Oswald;font-style:normal;font-display:swap;font-weight:200 700;src:url('/fonts/Oswald-var.woff2') format('woff2')}",
    `:root{${cssVars(DAY)}}`,
    `html[data-pz="night"]{${cssVars(NIGHT)}}`,
    "html,body{background:var(--pz-bg);color:var(--pz-text);font-family:Inter,system-ui,-apple-system,sans-serif}",
    ":focus-visible{outline:3px solid #121212;outline-offset:2px}",
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
    const night = isNight(new Date());
    document.documentElement.dataset.pz = night ? "night" : "day";

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
  setInterval(() => {
    if (document.hidden) return;
    apply();
  }, 60_000);
  document.addEventListener("visibilitychange", apply);
}

installTheme();
