# Preyas ball

Two GLBs of the same grey ball. Do not commit other models here.

| File | Where it loads | Compression |
| --- | --- | --- |
| `preyas_ball.glb` | Web (`loadPreyas.ts`) | `EXT_meshopt_compression` plus `KHR_mesh_quantization`. The browser decodes meshopt with WASM. |
| `preyas_ball.native.glb` | iOS and Android (`loadPreyas.native.ts`) | `KHR_mesh_quantization` only. Hermes has no WebAssembly, so meshopt is not used. |

Both are one skinned mesh, about 7,340 triangles, vertex colours, no texture. Bones: `root` > `base` > {`footL`, `footR`, `body` > {`head`, `collar`, `faceplate`, `flapL` > `clawsL`, `flapR` > `clawsR`}}.

Clips: `open` (0.8 s), `close` (0.8 s), `closed` (0.1 s), `idle` (2.4 s loop), `happy` (1.0 s loop). The rest pose is the open shell. Flaps hinge on a tilted axis (about 0.75 rad off local Z), not a plain `rotateZ`.

`apps/mobile/scripts/check-ball-clips.mts` (`npm run check:ball`) checks the two compression paths, the hinge tilt, and that the maximum procedural flap, head tilt, look, and roll do not push the skinned shell below the authored clips.
