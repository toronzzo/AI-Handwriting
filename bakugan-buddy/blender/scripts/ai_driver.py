"""
Ripple AI body driver for Blender.

Parses the product contract `[mood] spoken line`, decides an INTENT
(what it is doing), then drives every movable bone toward targets —
same language as packages/body-core motionTargets().

Examples:
  blender --background out/ripple_rigged.blend --python scripts/ai_driver.py -- \
      --react "[excited] Let's make a splash!" --render --frames 24

  blender out/ripple_rigged.blend --python scripts/ai_driver.py -- \
      --mood listening --listen --talking
"""

from __future__ import annotations

import argparse
import json
import math
import re
import sys
from pathlib import Path

import bpy
from mathutils import Euler, Vector

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_BLEND = ROOT / "out" / "ripple_rigged.blend"
RENDERS = ROOT / "renders"

MOODS = {
    "idle",
    "listening",
    "thinking",
    "happy",
    "excited",
    "calm",
    "sad",
    "curious",
    "fierce",
    "mysterious",
    "amused",
    "surprised",
    "determined",
}

ALIASES = {
    "angry": "fierce",
    "mad": "fierce",
    "neutral": "idle",
    "joy": "happy",
    "hype": "excited",
    "listen": "listening",
    "think": "thinking",
    "battle": "determined",
}


def normalize_mood(m: str) -> str:
    x = m.lower().strip()
    if x in ALIASES:
        return ALIASES[x]
    return x if x in MOODS else "curious"


def react(tagged: str) -> tuple[str, str]:
    m = re.match(r"^\[([a-z]+)\]\s*([\s\S]*)$", tagged.strip(), re.I)
    if m:
        return normalize_mood(m.group(1)), m.group(2).strip()
    return "curious", tagged.strip()


def motion_targets(emotion: str, listening: bool, talking: bool) -> dict[str, float]:
    """Mirrors bakugan-buddy/packages/body-core motionTargets (sphere form)."""
    open_ = 0.0
    droop = 0.0
    eye = 0.55
    claw = 0.0
    hop = 0.0
    shake = 0.0
    lean = 0.55 if listening else 0.0
    rock = 0.12
    aura = 0.0

    if emotion in ("happy", "amused"):
        hop, eye, rock, aura = 0.85, 1.0, 0.12, 0.15
    elif emotion == "excited":
        open_, claw, eye, hop, aura, rock = 1.0, 1.0, 1.0, 0.35, 0.45, 0.0
    elif emotion == "determined":
        open_, claw, eye, aura, lean, rock = 1.0, 0.35, 1.0, 1.0, 0.4, 0.0
    elif emotion == "fierce":
        shake, eye, open_, lean, aura, rock = 0.55, 0.95, 0.35, 0.7, 0.7, 0.0
    elif emotion == "sad":
        droop, eye, rock, lean = 1.0, 0.22, 0.04, -0.15
    elif emotion in ("calm", "idle"):
        eye, rock = 0.5, 0.18
    elif emotion == "curious":
        eye, open_ = 0.8, 0.15
    elif emotion == "surprised":
        open_, eye, hop, aura, rock = 1.0, 1.0, 0.2, 0.35, 0.0
    elif emotion == "mysterious":
        eye, rock = 0.4, 0.06
    elif emotion == "listening":
        eye, lean, open_, rock = 0.85, 0.8, 0.12, 0.05
    elif emotion == "thinking":
        eye, lean, rock = 0.45, -0.1, 0.18

    if listening:
        lean = max(lean, 0.55)
        eye = max(eye, 0.75)
    if talking and open_ < 0.2:
        open_ = max(open_, 0.12)

    return {
        "open": open_,
        "droop": droop,
        "eye": eye,
        "claw": claw,
        "hop": hop,
        "shake": shake,
        "lean": lean,
        "rock": rock,
        "aura": aura,
    }


def decide_intent(emotion: str, targets: dict[str, float], listening: bool, talking: bool) -> str:
    """Named action the creature believes it is performing (body first, voice as modifier)."""
    # Body-language intent is primary — voice rides on top.
    if targets["open"] >= 0.85 and targets["claw"] >= 0.6:
        return "DEPLOY_SPEAK" if talking else "DEPLOY"
    if targets["open"] >= 0.7:
        return "POP_OPEN_SPEAK" if talking else "POP_OPEN"
    if targets["hop"] >= 0.5:
        return "HOP_SPEAK" if talking else "HOP"
    if targets["shake"] >= 0.3:
        return "SHAKE"
    if targets["droop"] >= 0.5:
        return "DROOP"
    if listening or emotion == "listening":
        return "LISTEN"
    if talking:
        return "SPEAK"
    if emotion == "thinking":
        return "THINK"
    if emotion == "curious":
        return "GLANCE"
    return "REST"


INTENT_DESC = {
    "REST": "Holding sphere form — soft living idle.",
    "LISTEN": "Leaning in; eyes bright; waiting on partner.",
    "SPEAK": "Talk-bob while the line plays — body carries the voice.",
    "POP_OPEN": "Snap-opening shell to show core (anime magnet pop).",
    "POP_OPEN_SPEAK": "Shell open + talk-bob — speaking while revealed.",
    "DEPLOY": "Open + claws out — show-off / battle ready.",
    "DEPLOY_SPEAK": "Deployed claws + speaking — dramatic show-off line.",
    "HOP": "Happy hop with landing squash.",
    "HOP_SPEAK": "Hopping while delivering a line.",
    "SHAKE": "Fierce rattle — protective anger.",
    "DROOP": "Sad sink — energy low, loyal soft.",
    "THINK": "Slow rock; eyes dim — working it out.",
    "GLANCE": "Slight open + wobble — curious peek.",
}


def get_rig() -> bpy.types.Object:
    arm = bpy.data.objects.get("RippleRig")
    if not arm or arm.type != "ARMATURE":
        raise RuntimeError("RippleRig armature not found — run build_ripple.py first")
    return arm


def pose_bone(pb: bpy.types.PoseBone, loc=None, rot_deg=None, scale=None) -> None:
    pb.rotation_mode = "XYZ"
    if loc is not None:
        pb.location = Vector(loc)
    if rot_deg is not None:
        pb.rotation_euler = Euler(tuple(math.radians(a) for a in rot_deg))
    if scale is not None:
        pb.scale = Vector(scale)


def apply_pose(arm: bpy.types.Object, targets: dict[str, float], t: float = 0.0) -> None:
    """Map targets → every movable bone. t is seconds for procedural motion."""
    bones = arm.pose.bones
    o = targets["open"]
    claw = targets["claw"]
    eye = targets["eye"]
    hop = targets["hop"]
    lean = targets["lean"]
    rock = targets["rock"]
    shake = targets["shake"]
    droop = targets["droop"]
    aura = targets["aura"]

    hop_y = abs(math.sin(t * 7.5)) * hop * 0.12
    rock_z = math.sin(t * 1.7) * rock * 12.0
    shake_x = math.sin(t * 28.0) * shake * 8.0
    talk_bob = math.sin(t * 9.0) * float(arm.get("ai_talking", 0)) * 0.03

    pose_bone(
        bones["ROOT"],
        loc=(shake_x * 0.002, lean * 0.04, hop_y - droop * 0.08 + talk_bob),
        rot_deg=(lean * 12.0 - droop * 8.0, shake_x, rock_z),
    )
    pose_bone(bones["BODY"], rot_deg=(0, 0, rock_z * 0.3))

    # Shell split
    pose_bone(bones["SHELL_UPPER"], loc=(0, 0, o * 0.22), rot_deg=(-o * 8, 0, 0))
    pose_bone(bones["SHELL_LOWER"], loc=(0, 0, -o * 0.12), rot_deg=(o * 6, 0, 0))

    # Core + rings scale with open / aura
    core_s = 0.55 + 0.45 * o + 0.1 * aura
    pose_bone(bones["CORE"], scale=(core_s, core_s, core_s))
    spin = t * (40 + 80 * aura)
    pose_bone(bones["RING_INNER"], rot_deg=(0, 0, spin))
    pose_bone(bones["RING_OUTER"], rot_deg=(70, spin * 0.7, 0), scale=(0.7 + 0.3 * o,) * 3)

    eye_s = 0.35 + 0.9 * eye
    pose_bone(bones["EYE"], scale=(eye_s, eye_s, eye_s), loc=(0, -0.02 * eye, 0))

    # Panel flutter when excited / open
    flutter = math.sin(t * 6.0) * o * 6
    pose_bone(bones["PANEL_A"], rot_deg=(flutter, 8 * o, 0))
    pose_bone(bones["PANEL_B"], rot_deg=(flutter, -8 * o, 0))
    pose_bone(bones["PANEL_C"], rot_deg=(-10 * o + flutter * 0.5, 0, 0))

    # Claws deploy + wave
    wave = math.sin(t * 5.0) * claw * 18
    spreads = {
        "CLAW_FL": (claw * 25 + wave, claw * 10, claw * 0.08),
        "CLAW_FR": (-claw * 25 - wave, claw * 10, claw * 0.08),
        "CLAW_BL": (claw * 18 + wave * 0.5, claw * 14, claw * 0.06),
        "CLAW_BR": (-claw * 18 - wave * 0.5, claw * 14, claw * 0.06),
    }
    for name, (rx, rz, retract) in spreads.items():
        # When claw=0, tuck toward body (negative scale / inward)
        tuck = 1.0 - claw
        pose_bone(
            bones[f"{name}_A"],
            loc=(-retract if "R" in name else retract, tuck * 0.05, tuck * 0.04),
            rot_deg=(rx * 0.3, 0, rz if "L" in name else -rz if False else rx),
            scale=(0.35 + 0.65 * claw,) * 3,
        )
        pose_bone(
            bones[f"{name}_B"],
            rot_deg=(wave * 0.4, 0, claw * 20),
            scale=(0.35 + 0.65 * claw,) * 3,
        )

    # Fix claw rotation mapping more clearly
    pose_bone(bones["CLAW_FL_A"], rot_deg=(0, 0, claw * 35 + wave), scale=(0.3 + 0.7 * claw,) * 3)
    pose_bone(bones["CLAW_FR_A"], rot_deg=(0, 0, -claw * 35 - wave), scale=(0.3 + 0.7 * claw,) * 3)
    pose_bone(bones["CLAW_BL_A"], rot_deg=(0, 0, claw * 25 + wave * 0.5), scale=(0.3 + 0.7 * claw,) * 3)
    pose_bone(bones["CLAW_BR_A"], rot_deg=(0, 0, -claw * 25 - wave * 0.5), scale=(0.3 + 0.7 * claw,) * 3)
    for name in ("CLAW_FL", "CLAW_FR", "CLAW_BL", "CLAW_BR"):
        pose_bone(bones[f"{name}_B"], rot_deg=(claw * 25 + wave * 0.3, 0, 0), scale=(0.3 + 0.7 * claw,) * 3)


def write_brain(arm: bpy.types.Object, mood: str, line: str, intent: str, targets: dict[str, float], listening: bool, talking: bool) -> dict:
    arm["ai_mood"] = mood
    arm["ai_intent"] = intent
    arm["ai_line"] = line[:200]
    arm["ai_listening"] = 1.0 if listening else 0.0
    arm["ai_talking"] = 1.0 if talking else 0.0
    for k, v in targets.items():
        arm[f"ai_{k}"] = float(v)

    state = {
        "identity": arm.get("ai_identity", "Ripple"),
        "mood": mood,
        "intent": intent,
        "intent_means": INTENT_DESC.get(intent, ""),
        "line": line,
        "listening": listening,
        "talking": talking,
        "targets": targets,
        "movable": [
            "ROOT",
            "BODY",
            "SHELL_UPPER",
            "SHELL_LOWER",
            "CORE",
            "RING_INNER",
            "RING_OUTER",
            "EYE",
            "PANEL_A",
            "PANEL_B",
            "PANEL_C",
            "CLAW_FL_A/B",
            "CLAW_FR_A/B",
            "CLAW_BL_A/B",
            "CLAW_BR_A/B",
        ],
    }
    out = ROOT / "out" / "ai_state.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(state, indent=2))
    print(json.dumps(state, indent=2))
    return state


def keyframe_all(arm: bpy.types.Object, frame: int) -> None:
    for pb in arm.pose.bones:
        pb.keyframe_insert(data_path="location", frame=frame)
        pb.keyframe_insert(data_path="rotation_euler", frame=frame)
        pb.keyframe_insert(data_path="scale", frame=frame)


def bake_action(arm: bpy.types.Object, targets: dict[str, float], frames: int, fps: int = 24) -> None:
    scene = bpy.context.scene
    scene.render.fps = fps
    scene.frame_start = 1
    scene.frame_end = frames
    if arm.animation_data is None:
        arm.animation_data_create()
    action = bpy.data.actions.new(name=f"AI_{arm['ai_intent']}")
    arm.animation_data.action = action
    for f in range(1, frames + 1):
        t = (f - 1) / fps
        apply_pose(arm, targets, t=t)
        keyframe_all(arm, f)
    scene.frame_set(1)


def setup_render(path: Path, frames: int) -> None:
    scene = bpy.context.scene
    # Headless VMs often lack a usable GPU EGL path — Cycles CPU is reliable.
    scene.render.engine = "CYCLES"
    scene.cycles.device = "CPU"
    scene.cycles.samples = 24
    scene.cycles.use_denoising = False
    scene.render.resolution_x = 800
    scene.render.resolution_y = 600
    scene.render.fps = 24
    scene.frame_start = 1
    scene.frame_end = frames
    scene.render.image_settings.file_format = "PNG"
    scene.render.filepath = str(path / "frame_")


def parse_args(argv: list[str]) -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Ripple AI Blender driver")
    p.add_argument("--react", type=str, default="", help='e.g. "[excited] Whoop!"')
    p.add_argument("--mood", type=str, default="idle")
    p.add_argument("--line", type=str, default="")
    p.add_argument("--listen", action="store_true")
    p.add_argument("--talking", action="store_true")
    p.add_argument("--frames", type=int, default=36)
    p.add_argument("--render", action="store_true")
    p.add_argument("--save", action="store_true", help="Save posed .blend")
    # Blender passes args after --
    if "--" in argv:
        argv = argv[argv.index("--") + 1 :]
    else:
        argv = []
    return p.parse_args(argv)


def main() -> None:
    args = parse_args(sys.argv)
    if args.react:
        mood, line = react(args.react)
    else:
        mood, line = normalize_mood(args.mood), args.line

    listening = args.listen or mood == "listening"
    talking = args.talking or bool(line)
    targets = motion_targets(mood, listening, talking)
    intent = decide_intent(mood, targets, listening, talking)

    arm = get_rig()
    state = write_brain(arm, mood, line, intent, targets, listening, talking)
    print(f"\n>>> Ripple intent: {intent} — {INTENT_DESC.get(intent, '')}")
    if line:
        print(f">>> Line: {line}")

    bake_action(arm, targets, frames=args.frames)

    if args.save:
        out = ROOT / "out" / f"ripple_{intent.lower()}.blend"
        bpy.ops.wm.save_as_mainfile(filepath=str(out))
        print("Saved", out)

    if args.render:
        RENDERS.mkdir(parents=True, exist_ok=True)
        tag = f"{intent.lower()}_{mood}"
        dest = RENDERS / tag
        dest.mkdir(parents=True, exist_ok=True)
        setup_render(dest, args.frames)
        # Render a few representative frames (1, mid, end) for speed
        for f in sorted({1, max(1, args.frames // 2), args.frames}):
            bpy.context.scene.frame_set(f)
            bpy.context.scene.render.filepath = str(dest / f"frame_{f:04d}")
            bpy.ops.render.render(write_still=True)
            print("Rendered", dest / f"frame_{f:04d}.png")
        # Also write state beside renders
        (dest / "ai_state.json").write_text(json.dumps(state, indent=2))


if __name__ == "__main__":
    main()
