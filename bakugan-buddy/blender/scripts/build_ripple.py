"""
Build a fully-rigged Ripple Aquos sphere in Blender.

Every detail is a separate mesh parented to a bone so AI / mood drivers
can move shells, core, eye, claws, and root body independently.

Run:
  blender --background --python bakugan-buddy/blender/scripts/build_ripple.py
"""

from __future__ import annotations

import math
import sys
from pathlib import Path

import bpy
from mathutils import Euler, Vector

ROOT = Path(__file__).resolve().parents[1]
OUT_BLEND = ROOT / "out" / "ripple_rigged.blend"
OUT_GLB = ROOT / "out" / "ripple_rigged.glb"


def clear_scene() -> None:
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for block in (bpy.data.meshes, bpy.data.materials, bpy.data.armatures, bpy.data.actions):
        for b in list(block):
            block.remove(b)


def mat(name: str, color: tuple[float, float, float, float], emission: float = 0.0) -> bpy.types.Material:
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nodes = m.node_tree.nodes
    links = m.node_tree.links
    nodes.clear()
    out = nodes.new("ShaderNodeOutputMaterial")
    bsdf = nodes.new("ShaderNodeBsdfPrincipled")
    bsdf.inputs["Base Color"].default_value = color
    bsdf.inputs["Roughness"].default_value = 0.28
    bsdf.inputs["Metallic"].default_value = 0.55
    if "Emission Color" in bsdf.inputs:
        bsdf.inputs["Emission Color"].default_value = color
        bsdf.inputs["Emission Strength"].default_value = emission
    elif "Emission" in bsdf.inputs:
        bsdf.inputs["Emission"].default_value = color
        if "Emission Strength" in bsdf.inputs:
            bsdf.inputs["Emission Strength"].default_value = emission
    links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])
    return m


def mesh_obj(name: str, mesh: bpy.types.Mesh, loc=(0, 0, 0)) -> bpy.types.Object:
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    obj.location = loc
    return obj


def uv_sphere(name: str, radius: float, segments=48, rings=24) -> bpy.types.Object:
    bpy.ops.mesh.primitive_uv_sphere_add(radius=radius, segments=segments, ring_count=rings, location=(0, 0, 0))
    obj = bpy.context.active_object
    obj.name = name
    bpy.ops.object.shade_smooth()
    return obj


def ico_sphere(name: str, radius: float, subdivisions=2) -> bpy.types.Object:
    bpy.ops.mesh.primitive_ico_sphere_add(radius=radius, subdivisions=subdivisions, location=(0, 0, 0))
    obj = bpy.context.active_object
    obj.name = name
    bpy.ops.object.shade_smooth()
    return obj


def cylinder(name: str, radius: float, depth: float) -> bpy.types.Object:
    bpy.ops.mesh.primitive_cylinder_add(radius=radius, depth=depth, location=(0, 0, 0))
    obj = bpy.context.active_object
    obj.name = name
    bpy.ops.object.shade_smooth()
    return obj


def cone(name: str, radius1: float, depth: float) -> bpy.types.Object:
    bpy.ops.mesh.primitive_cone_add(radius1=radius1, radius2=0.02, depth=depth, location=(0, 0, 0))
    obj = bpy.context.active_object
    obj.name = name
    bpy.ops.object.shade_smooth()
    return obj


def bisect_keep_upper(obj: bpy.types.Object) -> None:
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.mesh.bisect(plane_co=(0, 0, 0), plane_no=(0, 0, 1), clear_inner=True, clear_outer=False)
    bpy.ops.object.mode_set(mode="OBJECT")


def bisect_keep_lower(obj: bpy.types.Object) -> None:
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.mesh.bisect(plane_co=(0, 0, 0), plane_no=(0, 0, 1), clear_inner=False, clear_outer=True)
    bpy.ops.object.mode_set(mode="OBJECT")


def create_armature() -> bpy.types.Object:
    arm_data = bpy.data.armatures.new("RippleArmature")
    arm = bpy.data.objects.new("RippleRig", arm_data)
    bpy.context.collection.objects.link(arm)
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.mode_set(mode="EDIT")
    eb = arm_data.edit_bones

    def bone(name: str, head, tip, parent: str | None = None):
        b = eb.new(name)
        b.head = Vector(head)
        b.tail = Vector(tip)
        if parent:
            b.parent = eb[parent]
        return b

    bone("ROOT", (0, 0, -0.05), (0, 0, 0.15))
    bone("BODY", (0, 0, 0.0), (0, 0, 0.35), "ROOT")
    bone("SHELL_UPPER", (0, 0, 0.05), (0, 0, 0.55), "BODY")
    bone("SHELL_LOWER", (0, 0, 0.0), (0, 0, -0.4), "BODY")
    bone("CORE", (0, 0, 0.0), (0, 0, 0.25), "BODY")
    bone("RING_INNER", (0, 0, 0.0), (0, 0.2, 0.0), "CORE")
    bone("RING_OUTER", (0, 0, 0.0), (0, 0.28, 0.0), "CORE")
    bone("EYE", (0, -0.12, 0.05), (0, -0.28, 0.05), "CORE")
    bone("PANEL_A", (0.15, 0.1, 0.35), (0.25, 0.15, 0.45), "SHELL_UPPER")
    bone("PANEL_B", (-0.15, 0.1, 0.35), (-0.25, 0.15, 0.45), "SHELL_UPPER")
    bone("PANEL_C", (0.0, -0.18, 0.35), (0.0, -0.28, 0.45), "SHELL_UPPER")

    # Four claw chains (upper arm + tip)
    claw_defs = [
        ("CLAW_FL", (0.35, 0.15, -0.05), (0.55, 0.25, -0.15), (0.72, 0.32, -0.28)),
        ("CLAW_FR", (-0.35, 0.15, -0.05), (-0.55, 0.25, -0.15), (-0.72, 0.32, -0.28)),
        ("CLAW_BL", (0.32, -0.2, -0.08), (0.5, -0.28, -0.2), (0.65, -0.35, -0.35)),
        ("CLAW_BR", (-0.32, -0.2, -0.08), (-0.5, -0.28, -0.2), (-0.65, -0.35, -0.35)),
    ]
    for name, a, b, c in claw_defs:
        bone(f"{name}_A", a, b, "BODY")
        bone(f"{name}_B", b, c, f"{name}_A")

    bpy.ops.object.mode_set(mode="OBJECT")
    return arm


def parent_bone(obj: bpy.types.Object, arm: bpy.types.Object, bone: str) -> None:
    """Bone-parent while preserving the mesh's current world transform."""
    mw = obj.matrix_world.copy()
    obj.parent = arm
    obj.parent_type = "BONE"
    obj.parent_bone = bone
    bpy.context.view_layer.update()
    # Keep world matrix stable so closed shells still form one sphere at rest.
    obj.matrix_world = mw
    bpy.context.view_layer.update()


def assign_mats():
    return {
        "shell": mat("Shell", (0.08, 0.25, 0.78, 1.0)),
        "shell_deep": mat("ShellDeep", (0.03, 0.1, 0.42, 1.0)),
        "accent": mat("Accent", (0.2, 1.0, 0.92, 1.0), emission=2.5),
        "core": mat("Core", (0.35, 0.95, 1.0, 1.0), emission=6.0),
        "eye": mat("Eye", (1.0, 0.08, 0.08, 1.0), emission=4.0),
        "claw": mat("Claw", (0.42, 0.28, 1.0, 1.0), emission=0.4),
        "panel": mat("Panel", (0.12, 0.4, 0.95, 1.0)),
        "socket": mat("Socket", (0.02, 0.02, 0.03, 1.0)),
        "metal": mat("Metal", (0.55, 0.62, 0.7, 1.0)),
    }


def add_micro_details(arm: bpy.types.Object, mats: dict) -> list[bpy.types.Object]:
    """Hinge rivets, gill inserts, eye socket, hex studs, three-finger claws, pillars."""
    extras: list[bpy.types.Object] = []
    mapping: list[tuple[bpy.types.Object, str]] = []

    # Equator hinge rivets
    for i in range(12):
        a = (i / 12) * math.tau
        x, y = math.cos(a) * 0.505, math.sin(a) * 0.505
        bpy.ops.mesh.primitive_uv_sphere_add(radius=0.018, location=(x, y, 0.0))
        riv = bpy.context.active_object
        riv.name = f"Rivet{i}"
        riv.data.materials.append(mats["accent"] if i % 2 == 0 else mats["metal"])
        extras.append(riv)
        mapping.append((riv, "BODY"))

    # Side gill inlaid bars (3 per side)
    for side, sx in (("L", 1.0), ("R", -1.0)):
        for i in range(3):
            z = -0.08 + i * 0.1
            bpy.ops.mesh.primitive_cube_add(size=1.0, location=(sx * 0.42, 0.05, z))
            gill = bpy.context.active_object
            gill.name = f"Gill{side}{i}"
            gill.scale = (0.06, 0.02, 0.028)
            gill.data.materials.append(mats["accent"])
            extras.append(gill)
            mapping.append((gill, "BODY"))

    # Dark eye socket dish + rim
    bpy.ops.mesh.primitive_uv_sphere_add(radius=0.09, location=(0.0, -0.38, 0.18))
    socket = bpy.context.active_object
    socket.name = "EyeSocket"
    socket.scale = (1.35, 0.55, 0.85)
    socket.data.materials.append(mats["socket"])
    extras.append(socket)
    mapping.append((socket, "BODY"))

    bpy.ops.mesh.primitive_torus_add(
        major_radius=0.095, minor_radius=0.008, location=(0.0, -0.38, 0.18)
    )
    rim = bpy.context.active_object
    rim.name = "EyeRim"
    rim.rotation_euler = Euler((math.radians(90), 0, 0))
    rim.scale = (1.2, 0.7, 1.0)
    rim.data.materials.append(mats["metal"])
    extras.append(rim)
    mapping.append((rim, "BODY"))

    # Hex panel studs on upper shell
    hex_pts = [
        (0.0, 0.05, 0.42),
        (0.16, 0.12, 0.36),
        (-0.16, 0.12, 0.36),
        (0.0, -0.16, 0.38),
        (0.22, -0.02, 0.32),
        (-0.22, -0.02, 0.32),
    ]
    for i, loc in enumerate(hex_pts):
        bpy.ops.mesh.primitive_cylinder_add(radius=0.028, depth=0.012, location=loc)
        hx = bpy.context.active_object
        hx.name = f"HexStud{i}"
        hx.rotation_euler = Euler((math.radians(90), 0, 0))
        # Approximate hex look via 6 verts — keep cylinder, mark accent edge
        hx.data.materials.append(mats["panel"] if i % 2 else mats["accent"])
        extras.append(hx)
        mapping.append((hx, "SHELL_UPPER"))

    # Inner teal pillars (visible when open)
    for i, x in enumerate((-0.1, 0.0, 0.1)):
        cyl = cylinder(f"Pillar{i}", 0.022, 0.28)
        cyl.location = (x, 0.0, 0.0)
        cyl.data.materials.append(mats["accent"])
        extras.append(cyl)
        mapping.append((cyl, "CORE"))
        for j, z in enumerate((-0.06, 0.06)):
            bpy.ops.mesh.primitive_torus_add(
                major_radius=0.03, minor_radius=0.005, location=(x, 0.0, z)
            )
            collar = bpy.context.active_object
            collar.name = f"PillarCollar{i}_{j}"
            collar.data.materials.append(mats["accent"])
            extras.append(collar)
            mapping.append((collar, "CORE"))

    # Three-finger tips on each claw B bone
    for name, side in (
        ("CLAW_FL", 1),
        ("CLAW_FR", -1),
        ("CLAW_BL", 1),
        ("CLAW_BR", -1),
    ):
        tip_bone = f"{name}_B"
        base = {
            "CLAW_FL": Vector((0.72, 0.32, -0.28)),
            "CLAW_FR": Vector((-0.72, 0.32, -0.28)),
            "CLAW_BL": Vector((0.65, -0.35, -0.35)),
            "CLAW_BR": Vector((-0.65, -0.35, -0.35)),
        }[name]
        for fi, off in enumerate(((-0.03, 0.02), (0.0, 0.0), (0.03, -0.02))):
            finger = cone(f"{name}_F{fi}", 0.015, 0.07)
            finger.location = (base.x + side * off[0], base.y + off[1], base.z - 0.04)
            finger.data.materials.append(mats["claw"])
            extras.append(finger)
            mapping.append((finger, tip_bone))

    bpy.context.view_layer.update()
    for obj, bone in mapping:
        parent_bone(obj, arm, bone)
    return extras


def build_meshes(arm: bpy.types.Object, mats: dict) -> list[bpy.types.Object]:
    objs: list[bpy.types.Object] = []

    upper = uv_sphere("ShellUpper", 0.5)
    bisect_keep_upper(upper)
    upper.data.materials.append(mats["shell"])
    objs.append(upper)

    lower = uv_sphere("ShellLower", 0.5)
    bisect_keep_lower(lower)
    lower.data.materials.append(mats["shell_deep"])
    objs.append(lower)

    # Accent seam ring at equator
    bpy.ops.mesh.primitive_torus_add(major_radius=0.505, minor_radius=0.012, location=(0, 0, 0))
    seam = bpy.context.active_object
    seam.name = "SeamRing"
    seam.data.materials.append(mats["accent"])
    objs.append(seam)

    core = ico_sphere("Core", 0.18, subdivisions=3)
    core.data.materials.append(mats["core"])
    objs.append(core)

    bpy.ops.mesh.primitive_torus_add(major_radius=0.22, minor_radius=0.008, location=(0, 0, 0))
    ring1 = bpy.context.active_object
    ring1.name = "RingInner"
    ring1.data.materials.append(mats["accent"])
    objs.append(ring1)

    bpy.ops.mesh.primitive_torus_add(major_radius=0.28, minor_radius=0.006, location=(0, 0, 0))
    ring2 = bpy.context.active_object
    ring2.name = "RingOuter"
    ring2.rotation_euler = Euler((math.radians(70), 0, 0))
    ring2.data.materials.append(mats["accent"])
    objs.append(ring2)

    # Twin eye glints in dark recess
    bpy.ops.mesh.primitive_uv_sphere_add(radius=0.035, location=(0.045, -0.16, 0.06))
    eye_l = bpy.context.active_object
    eye_l.name = "EyeL"
    eye_l.data.materials.append(mats["eye"])
    objs.append(eye_l)
    bpy.ops.mesh.primitive_uv_sphere_add(radius=0.035, location=(-0.045, -0.16, 0.06))
    eye_r = bpy.context.active_object
    eye_r.name = "EyeR"
    eye_r.data.materials.append(mats["eye"])
    objs.append(eye_r)

    # Hex-ish panel accents on upper shell
    for i, (x, y, z) in enumerate([(0.18, 0.12, 0.38), (-0.18, 0.12, 0.38), (0.0, -0.2, 0.36)]):
        p = ico_sphere(f"Panel{i}", 0.05, subdivisions=1)
        p.location = (x, y, z)
        p.data.materials.append(mats["panel"])
        objs.append(p)

    # Claw segments
    claw_layout = [
        ("CLAW_FL", (0.42, 0.18, -0.05), (0.62, 0.28, -0.2)),
        ("CLAW_FR", (-0.42, 0.18, -0.05), (-0.62, 0.28, -0.2)),
        ("CLAW_BL", (0.38, -0.22, -0.08), (0.55, -0.3, -0.25)),
        ("CLAW_BR", (-0.38, -0.22, -0.08), (-0.55, -0.3, -0.25)),
    ]
    for name, a, tip in claw_layout:
        arm_seg = cylinder(f"{name}_Arm", 0.035, 0.22)
        arm_seg.location = a
        direction = Vector(tip) - Vector(a)
        arm_seg.rotation_mode = "QUATERNION"
        arm_seg.rotation_quaternion = direction.to_track_quat("Z", "Y")
        arm_seg.data.materials.append(mats["claw"])
        objs.append(arm_seg)

        tip_seg = cone(f"{name}_Tip", 0.04, 0.16)
        tip_seg.location = tip
        tip_seg.rotation_mode = "QUATERNION"
        tip_seg.rotation_quaternion = direction.to_track_quat("Z", "Y")
        tip_seg.data.materials.append(mats["claw"])
        objs.append(tip_seg)

    # Parent to bones (pose mode must be available)
    bpy.context.view_layer.update()
    mapping = [
        (upper, "SHELL_UPPER"),
        (lower, "SHELL_LOWER"),
        (seam, "BODY"),
        (core, "CORE"),
        (ring1, "RING_INNER"),
        (ring2, "RING_OUTER"),
        (eye_l, "EYE"),
        (eye_r, "EYE"),
        (objs[[o.name for o in objs].index("Panel0")], "PANEL_A"),
        (objs[[o.name for o in objs].index("Panel1")], "PANEL_B"),
        (objs[[o.name for o in objs].index("Panel2")], "PANEL_C"),
    ]
    for name, a, tip in claw_layout:
        mapping.append((bpy.data.objects[f"{name}_Arm"], f"{name}_A"))
        mapping.append((bpy.data.objects[f"{name}_Tip"], f"{name}_B"))

    for obj, bone in mapping:
        parent_bone(obj, arm, bone)

    return objs


def add_brain_properties(arm: bpy.types.Object) -> None:
    """Custom props the AI driver reads/writes — Ripple 'knows' its state."""
    props = {
        "ai_mood": "idle",
        "ai_intent": "REST",
        "ai_line": "",
        "ai_open": 0.0,
        "ai_claw": 0.0,
        "ai_eye": 0.55,
        "ai_hop": 0.0,
        "ai_lean": 0.0,
        "ai_rock": 0.1,
        "ai_shake": 0.0,
        "ai_droop": 0.0,
        "ai_aura": 0.0,
        "ai_talking": 0.0,
        "ai_listening": 0.0,
    }
    for k, v in props.items():
        arm[k] = v
        if isinstance(v, float):
            try:
                ui = arm.id_properties_ui(k)
                ui.update(min=0.0, max=1.0 if k != "ai_hop" else 2.0, soft_min=0.0, soft_max=1.0)
            except Exception:
                pass
    arm["ai_version"] = 1
    arm["ai_identity"] = "Ripple — Aquos pocket companion (original)"


def setup_world_camera() -> None:
    world = bpy.data.worlds.new("RippleWorld") if not bpy.data.worlds else bpy.context.scene.world
    if world is None:
        world = bpy.data.worlds.new("RippleWorld")
        bpy.context.scene.world = world
    world.use_nodes = True
    bg = world.node_tree.nodes.get("Background")
    if bg:
        bg.inputs[0].default_value = (0.01, 0.03, 0.06, 1)
        bg.inputs[1].default_value = 0.4

    bpy.ops.object.camera_add(location=(1.8, -2.4, 1.1), rotation=(math.radians(68), 0, math.radians(35)))
    cam = bpy.context.active_object
    cam.name = "RippleCam"
    bpy.context.scene.camera = cam

    bpy.ops.object.light_add(type="AREA", location=(1.2, -0.8, 2.2))
    key = bpy.context.active_object
    key.data.energy = 250
    key.data.size = 1.5

    bpy.ops.object.light_add(type="AREA", location=(-1.5, 1.0, 0.8))
    fill = bpy.context.active_object
    fill.data.energy = 80
    fill.data.size = 2.0
    fill.data.color = (0.4, 0.9, 1.0)


def main() -> None:
    clear_scene()
    mats = assign_mats()
    arm = create_armature()
    build_meshes(arm, mats)
    add_micro_details(arm, mats)
    add_brain_properties(arm)
    setup_world_camera()

    # Select rig as active
    bpy.context.view_layer.objects.active = arm
    arm.select_set(True)

    OUT_BLEND.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=str(OUT_BLEND))

    # Export glTF for web / engines
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.export_scene.gltf(
        filepath=str(OUT_GLB),
        export_format="GLB",
        export_animations=True,
        export_yup=True,
    )
    print(f"Saved {OUT_BLEND}")
    print(f"Exported {OUT_GLB}")


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print("BUILD FAILED:", e, file=sys.stderr)
        raise
