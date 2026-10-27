# Preyas ball — v2 (grey prototype)

`preyas_ball.glb` (v2, 162.6 KB, 7,340 tris, 1 mesh / 1 primitive / 1 material = 1 draw call, meshopt + quantization → load with MeshoptDecoder).
`preyas_ball_v1.glb` = previous version (v1 sources in `v1/`).

Bones / named parts: root, base, footL, footR, body, head, collar, faceplate, flapL, clawsL, flapR, clawsR.
Clips: open (0.8 s), close (0.8 s), closed, idle (2.4 s loop), happy (1.0 s loop).

v2 changes:
- Head hole tilted 0.28 rad forward (ref 2); big recessed dome (r 0.40) + neck post; separate `collar` band that is the hole rim when
  closed and slides down onto the dome base when open.
- Front shell: raised front disc + rim ring, 8 panel pads; flaps: raised stripes outside, ribs inside; back shell ribs; base pads + lid ladder.
- Flaps are now doors on a tilted (top-leaning-back, 0.75 rad) hinge at the back side with visible coaxial knuckles; they open 0.85 rad
  so they drop and curve forward like arms; claws at the lower front tips swing forward.
- Feet: flat extruded fin plates with 3 toes, 3 through-holes and 2 splayed fins, hinged with knuckles on the base; swing forward-down.
- Back mechanism: spring housing (cylinder + 4 coil rings + cap), side frame plates, cross axle with pin caps, faceplate slide rails.
- Faceplate: slides out on the rails, flips 180° about x (hub visible), slides back under the head.

Build: `./run.sh` (from 3d/bakugan; `nocheck` skips the clip check) then `python make_sheet.py` for gif/strip/sheet.
Clip check result: previews/clipping_check.txt (0 intersections, min y ≥ 0 in all clips). `diag.py` locates intersections.


---
(v1 notes)
# Preyas ball-form prototype (grey, untextured)
- `preyas_ball.glb`: the deliverable (meshopt-compressed; three.js needs `GLTFLoader.setMeshoptDecoder(MeshoptDecoder)`). `preyas_ball_raw.glb`: the uncompressed export.
- It is one SkinnedMesh with one material, so it renders in a single draw call. Vertex colours are flat greys, one per part. Each part is rigidly bound to one bone with weight 1.
- Bones/nodes: root > base > {footL, footR, body > {head, faceplate, flapL > clawsL, flapR > clawsR}}.
- The rest pose is the open form. Clips: `open` (0.8 s), `close` (0.8 s), `closed` (static pose), `idle` (2.4 s loop), `happy` (1.0 s loop).
- Mechanism:
  - The flaps rotate about a z-axis hinge. You can see the hinge knuckles beside the head hole: the flap knuckle sits between body knuckles on the same axis.
  - Each foot swings about its own knuckle hinge on the base.
  - The faceplate slides out and flips 180° about x. Its outer side is the front ball shell; its inner side is the pleated plate with teeth.
  - The head lifts straight out of the top hole, then moves forward and settles onto the plate.
  - The claws fold out from inside the flap rim.
  - root does a small hop during open/close so the swinging feet never go below the table.
- Pipeline: `./run.sh` does build (headless Chrome + GLTFExporter) -> gltf-transform weld+meshopt -> clipping check -> renders. Use `./run.sh nocheck` to skip the check.
  - model.js holds the geometry, the open pose and the timing. build.html adds the clips and exports. view.html renders and dumps vertices. tool.mjs drives it. check_clip.py runs the clipping test.
- Clipping check (check_clip.py):
  - It runs on the exported GLB.
  - It samples every clip: 97 frames each of open and close, 25 each of idle and happy, and 25 of the closed pose.
  - For each frame it takes the skinned vertices, splits each bone's geometry into watertight solids, and computes the boolean intersection volume of every pair of parts with manifold3d.
  - It also checks the table plane (y >= 0).
  - Result: previews/clipping_check.txt.
