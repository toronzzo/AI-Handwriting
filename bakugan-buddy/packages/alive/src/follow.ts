import {
  FOLLOW_RING_RADIUS,
  HURRY_DISTANCE,
  HURRY_HYSTERESIS,
  HURRY_SPEED,
  MAX_DT,
  MOVE_DEADZONE,
  SPOT_COUNT,
  TURN_RATE,
  WALK_SPEED,
} from "./tuning.ts";

export type Spot = { x: number; z: number; score: number };

export type StepOut = { x: number; z: number; moved: boolean; hurry: boolean };

const RING_COS = new Float64Array(SPOT_COUNT);
const RING_SIN = new Float64Array(SPOT_COUNT);
for (let i = 0; i < SPOT_COUNT; i++) {
  const angle = (i / SPOT_COUNT) * Math.PI * 2 + 0.35;
  RING_COS[i] = Math.cos(angle);
  RING_SIN[i] = Math.sin(angle);
}

export function hurryFor(distance: number, already: boolean): boolean {
  if (already) return distance > HURRY_DISTANCE - HURRY_HYSTERESIS;
  return distance > HURRY_DISTANCE;
}

/**
 * Eight spots on a ring around the partner. Scores are multiplied, 0 to 1-ish.
 * Beside the camera wins. The spot between the camera and the partner loses
 * so he does not stand in the lens. `holdIndex` is sticky so he does not flicker.
 * Writes into `spots`. Returns the winning index.
 */
export function scoreRing(
  playerX: number,
  playerZ: number,
  selfX: number,
  selfZ: number,
  camForwardX: number,
  camForwardZ: number,
  spots: Spot[],
  holdIndex: number,
): number {
  const mag = Math.hypot(camForwardX, camForwardZ) || 1;
  const fx = camForwardX / mag;
  const fz = camForwardZ / mag;
  let best = 0;
  let bestScore = -1;
  for (let i = 0; i < SPOT_COUNT; i++) {
    const sx = playerX + RING_COS[i]! * FOLLOW_RING_RADIUS;
    const sz = playerZ + RING_SIN[i]! * FOLLOW_RING_RADIUS;
    const facing = RING_COS[i]! * fx + RING_SIN[i]! * fz;
    const beside = 1 - Math.abs(facing);
    const visible = facing > -0.2 ? 1 : 0.2;
    const dx = sx - selfX;
    const dz = sz - selfZ;
    const near = 1 - Math.min(1, Math.sqrt(dx * dx + dz * dz) / (FOLLOW_RING_RADIUS * 4));
    const hold = i === holdIndex ? 1.18 : 1;
    const score = beside * visible * (0.4 + 0.6 * near) * hold;
    const spot = spots[i]!;
    spot.x = sx;
    spot.z = sz;
    spot.score = score;
    if (score > bestScore) {
      bestScore = score;
      best = i;
    }
  }
  return best;
}

/**
 * Step toward a point. Distance traveled is at most speed × clamped dt,
 * and never more than the remaining distance. Inside the dead zone he stays.
 */
export function stepToward(
  x: number,
  z: number,
  tx: number,
  tz: number,
  dt: number,
  hurry: boolean,
  out: StepOut,
): void {
  const dx = tx - x;
  const dz = tz - z;
  const dist2 = dx * dx + dz * dz;
  out.hurry = hurry;
  if (dist2 < MOVE_DEADZONE * MOVE_DEADZONE) {
    out.x = x;
    out.z = z;
    out.moved = false;
    return;
  }
  const dist = Math.sqrt(dist2);
  const speed = hurry ? HURRY_SPEED : WALK_SPEED;
  const capped = dt > MAX_DT ? MAX_DT : dt > 0 ? dt : 0;
  const step = Math.min(dist, speed * capped);
  const scale = step / dist;
  out.x = x + dx * scale;
  out.z = z + dz * scale;
  out.moved = step > 0;
}

export function turnToward(
  yaw: number,
  tx: number,
  tz: number,
  x: number,
  z: number,
  dt: number,
): number {
  const dx = tx - x;
  const dz = tz - z;
  if (dx * dx + dz * dz < 1e-8) return yaw;
  const target = Math.atan2(dx, dz);
  const delta = Math.atan2(Math.sin(target - yaw), Math.cos(target - yaw));
  const capped = dt > MAX_DT ? MAX_DT : dt > 0 ? dt : 0;
  const max = TURN_RATE * capped;
  if (Math.abs(delta) <= max) return target;
  return yaw + Math.sign(delta) * max;
}
