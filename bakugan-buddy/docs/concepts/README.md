# Concepts

Exploratory art and interactive mocks — not wired into the Expo app yet.

## Ripple 2D model (SVG)

Original Aquos-style sphere companion (public-safe). Browser SVG + motion (no Blender required).

| File | What |
| --- | --- |
| [`ripple-2d-model.html`](./ripple-2d-model.html) | Interactive 2D model — closed / open core / deploy / spin |
| [`assets/ripple-2d-model-sheet.jpg`](./assets/ripple-2d-model-sheet.jpg) | Concept model sheet (closed → open → deployed) |

```bash
python3 -m http.server 8765 --directory bakugan-buddy/docs/concepts
# → http://127.0.0.1:8765/ripple-2d-model.html
```

## Ripple Blender AI rig

Fully movable parts (shells, core, rings, eyes, claws) driven by the same `[mood] line` contract as the companion brain. See [`../blender/README.md`](../blender/README.md).
