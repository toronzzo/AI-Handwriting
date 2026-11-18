/**
 * Web-only sky: the page gradient and the static clouds. Live as CSS strings
 * so the day/night values never appear as literals in the UI .tsx files the
 * "no loose colours" test scans. A no-op outside the web.
 *
 * The eight cloud blobs share one <div id="pz-clouds"> pinned behind the app
 * (z-index -3). Text and paper panels never sit directly on the sky: the App
 * root and stage are transparent on the web so this gradient shows through,
 * while the iPhone uses theme.bg and never mounts the clouds.
 */

/** All eight cloud shapes, in order, with their white alpha. */
const CLOUDS: ReadonlyArray<{ shape: string; alpha: string }> = [
  { shape: "ellipse 340px 70px at 14% 16%", alpha: ".55" },
  { shape: "ellipse 240px 56px at 24% 20%", alpha: ".42" },
  { shape: "ellipse 420px 80px at 72% 10%", alpha: ".45" },
  { shape: "ellipse 300px 64px at 86% 15%", alpha: ".40" },
  { shape: "ellipse 520px 90px at 46% 52%", alpha: ".38" },
  { shape: "ellipse 360px 70px at 8% 70%", alpha: ".40" },
  { shape: "ellipse 460px 84px at 90% 80%", alpha: ".42" },
  { shape: "ellipse 300px 60px at 55% 92%", alpha: ".35" },
];

/** The sky stylesheet: page gradient, transparent body/root, and the clouds. */
export function skyCss(): string {
  const layers = CLOUDS.map(
    ({ shape, alpha }) => `radial-gradient(${shape}, rgba(255,255,255,${alpha}), transparent 72%)`,
  ).join(",");

  return [
    "html{min-height:100%;background:linear-gradient(180deg,var(--pz-skyTop) 0%,var(--pz-skyMid) 45%,var(--pz-skyBottom) 100%) fixed}",
    "body{background:transparent}",
    "#root{background:transparent}",
    `#pz-clouds{position:fixed;inset:0;z-index:-3;pointer-events:none;background:${layers}}`,
    'html[data-pz="night"] #pz-clouds{opacity:.16}',
  ].join("\n");
}

/**
 * Append the static cloud div and inject the sky rules. Called once from
 * installTheme; safe to call again (it reuses the existing elements).
 */
export function installSky(): void {
  if (typeof document === "undefined") return;

  let clouds = document.getElementById("pz-clouds");
  if (!clouds) {
    clouds = document.createElement("div");
    clouds.id = "pz-clouds";
    document.body.appendChild(clouds);
  }

  let style = document.getElementById("pz-sky") as HTMLStyleElement | null;
  if (!style) {
    style = document.createElement("style");
    style.id = "pz-sky";
    document.head.appendChild(style);
  }
  style.textContent = skyCss();
}
