/**
 * Web-only riso sky: flat paper, one drawn horizon rule, a halftone sun disc
 * and a fine grain layer. Lives as CSS strings so the day/night values never
 * appear as literals in the UI .tsx files the "no loose colours" test scans.
 * A no-op outside the web.
 *
 * The paper, the horizon and the sun sit behind the app (#pz-sky at
 * z-index -3); the grain floats above the whole page (z-index 9999,
 * pointer-events none) so the print texture covers the paper and the panels
 * alike. The App root and stage are transparent on the web so the paper
 * shows through, while the iPhone draws the same sky with the Grain overlay
 * in App.tsx and theme.bg as the page colour.
 */

/** The sky stylesheet: flat paper, the drawn horizon, the sun and the grain. */
export function skyCss(): string {
  return [
    "html{min-height:100%;background:var(--pz-bg) fixed}",
    "body{background:transparent}",
    "#root{background:transparent}",
    "#pz-sky{position:fixed;inset:0;z-index:-3;pointer-events:none}",
    '#pz-sky::before{content:"";position:absolute;left:0;right:0;top:44%;height:1.5px;background:var(--pz-lineStrong)}',
    "#pz-sun{position:absolute;right:7%;top:calc(44% - 110px);width:220px;height:220px;border-radius:50%;background:var(--pz-ochre);border:1.5px solid var(--pz-lineStrong);overflow:hidden}",
    '#pz-sun::after{content:"";position:absolute;inset:0;background-image:radial-gradient(circle,var(--pz-bg) 22%,transparent 25%);background-size:18px 18px}',
    "#pz-grain{position:fixed;inset:0;z-index:9999;pointer-events:none;opacity:.07;background-image:url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='200' height='200'><filter id='g'><feTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2' stitchTiles='stitch'/><feColorMatrix type='saturate' values='0'/></filter><rect width='200' height='200' filter='url(%23g)'/></svg>\")}",
    'html[data-pz="night"] #pz-grain{opacity:.09}',
  ].join("\n");
}

/**
 * Append the sky, sun and grain elements and inject the sky rules. Called
 * once from installTheme; safe to call again (it reuses the existing
 * elements). The old cloud div from the blue-sky theme is removed if a hot
 * reload left one behind.
 */
export function installSky(): void {
  if (typeof document === "undefined") return;

  const stale = document.getElementById("pz-clouds");
  if (stale) stale.remove();

  let sky = document.getElementById("pz-sky");
  if (!sky) {
    sky = document.createElement("div");
    sky.id = "pz-sky";
    const sun = document.createElement("div");
    sun.id = "pz-sun";
    sky.appendChild(sun);
    document.body.appendChild(sky);
  }

  let grain = document.getElementById("pz-grain");
  if (!grain) {
    grain = document.createElement("div");
    grain.id = "pz-grain";
    document.body.appendChild(grain);
  }

  let style = document.getElementById("pz-sky-style") as HTMLStyleElement | null;
  if (!style) {
    style = document.createElement("style");
    style.id = "pz-sky-style";
    document.head.appendChild(style);
  }
  style.textContent = skyCss();
}

/**
 * The shade drawn over the user's own bg picture (slice 10). The app has no
 * gradient package, so it is six stacked bands from the top colour to the
 * bottom one. Those values live in the palette (bgShadeTop / bgShadeBottom);
 * nothing is hard-coded here.
 */
export const SHADE_BANDS = [0, 0.2, 0.4, 0.6, 0.8, 1] as const;

/**
 * Mix two translucent colour strings channel by channel, t 0 = from and
 * t 1 = to. Accepts rgb(r,g,b) / rgba(r,g,b,a). The result is used for a
 * single layer, so its alpha is the mixed alpha (0..1), not scaled.
 */
export function mixColour(from: string, to: string, t: number): string {
  const parse = (value: string): number[] => {
    const inner = value.slice(value.indexOf("(") + 1, value.lastIndexOf(")")).split(",");
    return [0, 1, 2, 3].map((n) => Number(inner[n] ?? (n === 3 ? 1 : 0)));
  };
  const a = parse(from);
  const b = parse(to);
  const mixed = a.map((channel, n) => Math.round(channel + ((b[n] ?? 0) - channel) * t));
  const alpha = Math.max(0, Math.min(1, mixed[3] ?? 1));
  return `rgba(${mixed[0]},${mixed[1]},${mixed[2]},${alpha.toFixed(3)})`;
}
