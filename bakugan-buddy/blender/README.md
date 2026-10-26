# Ripple — Blender AI rig

Fully **movable** Aquos sphere: every shell, panel, core ring, eye, and claw segment is on its own bone. An **AI driver** reads the product mood contract and decides an **intent** (what Ripple believes it is doing), then poses the rig.

## Layout

| Path | Role |
| --- | --- |
| `scripts/build_ripple.py` | Build rigged mesh + armature + brain custom props |
| `scripts/ai_driver.py` | `[mood] line` → intent → bone animation (+ optional renders) |
| `out/ripple_rigged.blend` | Generated Blender file |
| `out/ripple_rigged.glb` | glTF export for engines / web |
| `out/ai_state.json` | Last AI state (mood, intent, targets) |
| `renders/` | PNG frames from `--render` |

## Blender binary

Not committed (≈1.3 GB). Use a local install or the cloud copy:

```bash
# if present in this environment:
export BLENDER=/workspace/tools/blender/blender-4.2.5-linux-x64/blender
# or: export BLENDER=$(which blender)
```

## Build the model

```bash
"$BLENDER" --background --python bakugan-buddy/blender/scripts/build_ripple.py
```

Creates `out/ripple_rigged.blend` + `.glb`.

## Drive it like the companion AI

Same contract as `body-core` / M3 LLM output:

```text
[mood] Spoken line.
```

```bash
"$BLENDER" --background bakugan-buddy/blender/out/ripple_rigged.blend \
  --python bakugan-buddy/blender/scripts/ai_driver.py -- \
  --react "[excited] Let's make a splash!" --frames 36 --render --save
```

Other intents emerge from mood targets: `REST`, `LISTEN`, `SPEAK`, `POP_OPEN`, `DEPLOY`, `HOP`, `SHAKE`, `DROOP`, `THINK`, `GLANCE`.

```bash
# sad droop
"$BLENDER" --background bakugan-buddy/blender/out/ripple_rigged.blend \
  --python bakugan-buddy/blender/scripts/ai_driver.py -- \
  --react "[sad] Aw, partner…" --render

# listening lean
"$BLENDER" --background bakugan-buddy/blender/out/ripple_rigged.blend \
  --python bakugan-buddy/blender/scripts/ai_driver.py -- \
  --mood listening --listen --render
```

Open the `.blend` in the Blender GUI to scrub the action and inspect custom properties on `RippleRig` (`ai_mood`, `ai_intent`, `ai_line`, …).

## Movable parts

`ROOT` · `BODY` · `SHELL_UPPER` · `SHELL_LOWER` · `CORE` · `RING_INNER` · `RING_OUTER` · `EYE` · `PANEL_A/B/C` · `CLAW_*_A/B` (4 claws × 2 bones)

## Micro detail (build)

`build_ripple.py` also stamps toy-scale hardware parented to those bones:

- equator **hinge rivets** · side **gill inserts** · dark **eye socket + metal rim**
- upper-shell **hex studs** · inner **teal pillars** with collars (show when open)
- **three-finger** claw tips on each `CLAW_*_B`
