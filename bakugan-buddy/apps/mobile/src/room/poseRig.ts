import {
  AnimationMixer,
  LoopOnce,
  Quaternion,
  Vector3,
  type AnimationClip,
  type Object3D,
  type SkinnedMesh,
} from "three";

/** Crossfade length for open/close and for procedural offsets. */
export const POSE_FADE_SEC = 0.28;

const scratchQ = new Quaternion();

/**
 * Axis the close clip rotates this bone around, in the bone's local space.
 * v2 flaps hinge on a tilted axis (about 0.75 rad off local Z), so a
 * `rotateZ` added on top does not match the knuckle.
 * Writes the closing direction into `out`.
 */
export function closingHinge(
  bone: Object3D,
  mixer: AnimationMixer,
  clip: AnimationClip,
  sampleSec: number,
  out: Vector3,
): void {
  const action = mixer.clipAction(clip);
  action.setLoop(LoopOnce, 1);
  action.clampWhenFinished = true;
  action.reset();
  action.setEffectiveWeight(1);
  action.play();
  action.time = 0;
  mixer.update(0);
  const start = bone.quaternion.clone();
  action.time = sampleSec;
  mixer.update(0);
  const later = bone.quaternion.clone();
  action.stop();
  const delta = start.invert().multiply(later);
  out.set(delta.x, delta.y, delta.z);
  const len = out.length();
  if (len < 1e-6) {
    out.set(0, 0, 1);
    return;
  }
  out.multiplyScalar(1 / len);
}

/** Angle between `axis` and local Z, in radians. */
export function tiltFromZ(axis: Vector3): number {
  const z = axis.z < 0 ? -axis.z : axis.z;
  const clamped = z > 1 ? 1 : z;
  return Math.acos(clamped);
}

/** Extra local rotation after the mixer. `angle` is radians about `axis`. */
export function applyAxis(bone: Object3D, axis: Vector3, angle: number): void {
  if (angle < 1e-5 && angle > -1e-5) return;
  scratchQ.setFromAxisAngle(axis, angle);
  bone.quaternion.multiply(scratchQ);
}

/**
 * Coefficient for `floorLift`. Roll is a Z rotation, and yaw does not change
 * world Y, so this is the |sin(roll)| term that puts the lowest skinned
 * vertex back on its unrolled height. Measured at `roll` (the pose limit).
 */
export function measureFootRadius(mesh: SkinnedMesh, roll = 0.16): number {
  mesh.skeleton.update();
  const position = mesh.geometry.attributes.position;
  if (!position) return 0.05;
  const vertex = new Vector3();
  const sine = Math.sin(roll);
  const cosine = Math.cos(roll);
  const mag = sine < 0 ? -sine : sine;
  if (mag < 1e-5) return 0;
  let before = Infinity;
  let after = Infinity;
  for (let i = 0; i < position.count; i++) {
    vertex.fromBufferAttribute(position, i);
    mesh.applyBoneTransform(i, vertex);
    if (vertex.y < before) before = vertex.y;
    const down = vertex.x * mag;
    const yA = vertex.y * cosine + down;
    const yB = vertex.y * cosine - down;
    const low = yA < yB ? yA : yB;
    if (low < after) after = low;
  }
  const drop = before - after;
  return drop > 0 ? drop / mag : 0;
}

/**
 * World-unit lift so a roll about the floor pivot does not plant the base
 * through the ground. `footRadius` is model units; `scale` is the group scale.
 */
export function floorLift(roll: number, footRadius: number, scale: number): number {
  const sine = Math.sin(roll);
  const mag = sine < 0 ? -sine : sine;
  return footRadius * scale * mag;
}
