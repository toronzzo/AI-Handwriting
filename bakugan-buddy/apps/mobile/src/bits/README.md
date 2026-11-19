# Writing the pixel art (slice 8A)

The pixel sprites in this folder are built from one drawing function per
mood. Change a pose by editing the numbers for that mood and pasting the
printed grid back into `preyasSprite.ts`.

Characters used by the builder:

```
.  nothing (transparent)
K  outline (palette 1)
D  body - deep water (palette 3)
W  light water / belly (palette 4)
A  fin membrane - aqua (palette 5)
```

Copy the snippet below to `/tmp/art.mjs` and run `node /tmp/art.mjs`; it
writes nothing, it only prints every mood as a grid of `.`, `K`, `D`, `W`
and `A`. Translate the grid to palette digits with the table above
(`.`=0, `K`=1, `D`=3, `W`=4, `A`=5).

```js
const W = 24, H = 24;
const BLANK = () => Array.from({ length: H }, () => Array(W).fill("."));
const set = (g, x, y, ch) => { x = Math.round(x); y = Math.round(y); if (x >= 0 && x < W && y >= 0 && y < H) g[y][x] = ch; };
const blob = (g, cx, cy, rx, ry, ch) => { if (rx <= 0 || ry <= 0) return; for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1) set(g, x, y, ch); };
const outline = (g) => {
  const add = [];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (g[y][x] !== ".") continue;
    for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]]) { const nx = x + dx, ny = y + dy; const v = nx>=0&&nx<W&&ny>=0&&ny<H ? g[ny][nx] : "."; if (v !== "." && v !== "K") { add.push([x, y]); break; } }
  }
  for (const [x, y] of add) set(g, x, y, "K");
};
// body (bx,by), head (hx,hy), tail chain [x,y,r], tail fin offset, crest lobes, feet, belly, arm
function preyas(P) {
  const g = BLANK();
  for (const [x, y, r] of P.tail) blob(g, x, y, r, r, "D");
  const last = P.tail[P.tail.length - 1];
  blob(g, last[0] + P.fin, last[1] - 1.5, 1.2, 1.5, "A");
  blob(g, last[0] + P.fin, last[1] + 1.5, 1.2, 1.5, "A");
  for (const f of P.feet) blob(g, f[0], f[1], 1.6, 1.1, "W");
  for (const [x, y, rx, ry] of P.crest) blob(g, x, y, rx, ry, "A");
  blob(g, P.bx, P.by, 6.2, 5.4, "D");
  blob(g, P.hx, P.hy, 4.0, 3.6, "D");
  blob(g, P.belly[0], P.belly[1], P.belly[2], P.belly[3], "W");
  blob(g, P.arm[0], P.arm[1], 1.5, 1.4, "D");
  outline(g);
  return g;
}
const base = {
  bx: 11, by: 14.5, hx: 14, hy: 8, fin: -1.5,
  tail: [[6, 18, 2.1], [3.5, 19.5, 1.6], [1.6, 18.6, 1.2]],
  feet: [[9, 20], [14.5, 20.5]],
  crest: [[11.5, 4.5, 2.4, 2.0], [9, 5.5, 1.6, 1.5]],
  belly: [11, 16, 3.8, 3.0],
  arm: [6.5, 15],
};
const moods = {
  neutral: base,
  happy: { ...base, by: 14, hy: 7.5, tail: [[6, 18, 2.1], [3, 18, 1.6], [1, 15.5, 1.2]], crest: [[11.5, 3.5, 2.6, 2.2], [8.5, 4.5, 1.7, 1.6]], feet: [[9, 19], [14.5, 19.5]] },
  excited: { ...base, by: 13, hy: 6.5, tail: [[6, 17, 2.1], [3, 15.5, 1.6], [1, 12.5, 1.2]], crest: [[11.5, 2.5, 2.8, 2.2], [8.5, 3.5, 1.8, 1.7]], feet: [[9, 18], [14.5, 18.5]], belly: [11, 14.5, 3.8, 3.0] },
  angry: { ...base, hx: 14.5, hy: 9.5, crest: [[11.5, 6.5, 2.2, 1.8], [9, 7.5, 1.5, 1.4]], feet: [[8.5, 20], [15, 20.5]], arm: [6.5, 16] },
  sad: { ...base, by: 16.5, hx: 14.5, hy: 12.5, tail: [[6, 20, 1.9], [3, 21, 1.4], [1, 22, 1.0]], crest: [[11.5, 9, 1.8, 1.4], [9.3, 9.8, 1.2, 1.0]], feet: [[9, 21.5], [15, 21.8]], belly: [11, 18, 3.8, 2.6], arm: [6.5, 17] },
  surprised: { ...base, hy: 6.5, crest: [[11.5, 2.5, 2.6, 2.2], [9, 3.5, 1.7, 1.6]], tail: [[6, 18, 2.1], [3, 20, 1.6], [1.6, 18, 1.2]] },
  thinking: { ...base, hx: 15, hy: 8.5, crest: [[12.5, 5, 2.2, 1.8], [10, 6, 1.5, 1.4]], arm: [7, 13.5] },
  listening: { ...base, hx: 15.5, hy: 10, by: 14.5, crest: [[13, 6.5, 2.2, 1.8], [10.5, 7.5, 1.5, 1.4]], tail: [[6, 18.5, 2.0], [3.5, 19.8, 1.5], [1.6, 18.9, 1.1]] },
  battle: { ...base, by: 14, hy: 7, crest: [[11.5, 2.5, 2.8, 2.4], [8.5, 3.5, 2.0, 1.8]], feet: [[8, 20], [15.5, 20.5]], tail: [[6, 17.5, 2.1], [3.5, 18.5, 1.6], [1.6, 17, 1.2]] },
};
const out = [];
for (const [name, P] of Object.entries(moods)) { out.push("=== " + name); out.push(preyas(P).map((r) => r.join("")).join("\n")); }
console.log(out.join("\n"));
```
