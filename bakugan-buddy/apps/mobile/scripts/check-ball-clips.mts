/**
 * Reproducible ball check. Run: npm run check:ball
 * Confirms the web GLB is meshopt, the native GLB is quantization-only,
 * flap hinges match the tilted knuckle, and max procedural offsets
 * do not sink the shell below the authored clips.
 */
import { readFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { AnimationMixer, LoopRepeat, Vector3, type AnimationClip, type SkinnedMesh } from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { AliveController } from "../../../packages/alive/src/index.ts";
import type { AliveInput } from "../../../packages/alive/src/types.ts";
import { POSE_LIMITS } from "../../../packages/alive/src/tuning.ts";
import { applyAxis, closingHinge, measureFootRadius, tiltFromZ } from "../src/room/poseRig.ts";

const webPath = new URL("../assets/models/preyas_ball.glb", import.meta.url);
const nativePath = new URL("../assets/models/preyas_ball.native.glb", import.meta.url);
const failures: string[] = [];

function fail(message: string): void {
  failures.push(message);
}

function glbJson(bytes: Buffer): { extensionsUsed?: string[]; extensionsRequired?: string[] } {
  const magic = bytes.readUInt32LE(0);
  if (magic !== 0x46546c67) throw new Error("not a glb");
  const length = bytes.readUInt32LE(12);
  const type = bytes.readUInt32LE(16);
  if (type !== 0x4e4f534a) throw new Error("first chunk is not JSON");
  const text = bytes.subarray(20, 20 + length).toString("utf8");
  return JSON.parse(text) as { extensionsUsed?: string[]; extensionsRequired?: string[] };
}

function hasExt(doc: { extensionsUsed?: string[]; extensionsRequired?: string[] }, name: string): boolean {
  return (doc.extensionsUsed ?? []).includes(name) || (doc.extensionsRequired ?? []).includes(name);
}

const scratch = new Vector3();
const clawL = new Vector3();
const clawR = new Vector3();
const AXIS_X = new Vector3(1, 0, 0);
const AXIS_Y = new Vector3(0, 1, 0);

function minSkinnedY(mesh: SkinnedMesh): number {
  mesh.skeleton.update();
  mesh.updateWorldMatrix(true, false);
  const position = mesh.geometry.attributes.position;
  if (!position) return 0;
  let min = Infinity;
  for (let i = 0; i < position.count; i++) {
    scratch.fromBufferAttribute(position, i);
    mesh.applyBoneTransform(i, scratch);
    scratch.applyMatrix4(mesh.matrixWorld);
    if (scratch.y < min) min = scratch.y;
  }
  return min;
}

function poseClip(mixer: AnimationMixer, clip: AnimationClip, time: number): void {
  mixer.stopAllAction();
  const action = mixer.clipAction(clip);
  action.setLoop(LoopRepeat, Infinity);
  action.clampWhenFinished = false;
  action.enabled = true;
  action.reset();
  action.setEffectiveWeight(1);
  action.play();
  action.time = time;
  mixer.update(0);
}

const web = glbJson(readFileSync(webPath));
const native = glbJson(readFileSync(nativePath));
const nativeBytes = readFileSync(nativePath).length;
if (!hasExt(web, "EXT_meshopt_compression")) fail("web glb is missing EXT_meshopt_compression");
if (hasExt(native, "EXT_meshopt_compression")) fail("native glb still has EXT_meshopt_compression");
if (!hasExt(native, "KHR_mesh_quantization")) fail("native glb is missing KHR_mesh_quantization");
if (nativeBytes > 1_200_000) fail(`native glb is ${nativeBytes} bytes`);

const nativeFile = readFileSync(nativePath);
const loader = new GLTFLoader();
const gltf = await loader.parseAsync(
  nativeFile.buffer.slice(nativeFile.byteOffset, nativeFile.byteOffset + nativeFile.byteLength),
  "",
);

const clips = new Map<string, AnimationClip>();
for (const clip of gltf.animations) clips.set(clip.name, clip);
for (const name of ["open", "close", "closed", "idle", "happy"]) {
  if (!clips.has(name)) fail(`missing clip ${name}`);
}

let mesh: SkinnedMesh | null = null;
gltf.scene.traverse((obj) => {
  const skinned = obj as SkinnedMesh;
  if (skinned.isSkinnedMesh) mesh = skinned;
});
if (!mesh) fail("no skinned mesh");

const mixer = new AnimationMixer(gltf.scene);
const flapL = gltf.scene.getObjectByName("flapL");
const flapR = gltf.scene.getObjectByName("flapR");
const head = gltf.scene.getObjectByName("head");
const clawsL = gltf.scene.getObjectByName("clawsL");
const clawsR = gltf.scene.getObjectByName("clawsR");
const close = clips.get("close");
if (!flapL || !flapR || !head || !clawsL || !clawsR || !close || !mesh) {
  console.error(failures.concat(["rig is missing a named bone"]).join("\n"));
  process.exit(1);
}

const axisL = new Vector3();
const axisR = new Vector3();
closingHinge(flapL, mixer, close, 0.4, axisL);
closingHinge(flapR, mixer, close, 0.4, axisR);
const tiltL = tiltFromZ(axisL);
const tiltR = tiltFromZ(axisR);
console.log(
  `hingeL (${axisL.x.toFixed(3)}, ${axisL.y.toFixed(3)}, ${axisL.z.toFixed(3)}) tilt ${tiltL.toFixed(3)} rad`,
);
console.log(
  `hingeR (${axisR.x.toFixed(3)}, ${axisR.y.toFixed(3)}, ${axisR.z.toFixed(3)}) tilt ${tiltR.toFixed(3)} rad`,
);
if (tiltL < 0.55 || tiltL > 1.05) fail(`flapL hinge tilt ${tiltL.toFixed(3)} is outside 0.55..1.05`);
if (tiltR < 0.55 || tiltR > 1.05) fail(`flapR hinge tilt ${tiltR.toFixed(3)} is outside 0.55..1.05`);

const skinned: SkinnedMesh = mesh;
const idle = clips.get("idle")!;
poseClip(mixer, idle, 0);
const foot = measureFootRadius(skinned, POSE_LIMITS.rollMax);
gltf.scene.updateMatrixWorld(true);
clawsL.getWorldPosition(clawL);
clawsR.getWorldPosition(clawR);
const closedSpan = clawL.distanceTo(clawR);
applyAxis(flapL, axisL, -POSE_LIMITS.flapMax);
applyAxis(flapR, axisR, -POSE_LIMITS.flapMax);
gltf.scene.updateMatrixWorld(true);
clawsL.getWorldPosition(clawL);
clawsR.getWorldPosition(clawR);
const openSpan = clawL.distanceTo(clawR);
console.log(`claws span rest ${closedSpan.toFixed(4)} open-offset ${openSpan.toFixed(4)} foot ${foot.toFixed(4)}`);
if (!(openSpan > closedSpan + 0.002)) {
  fail(`negative hinge did not open the claws (${closedSpan.toFixed(4)} -> ${openSpan.toFixed(4)})`);
}

function sampleTimes(clip: AnimationClip): number[] {
  const times = [0];
  const step = clip.duration > 0.2 ? 0.2 : clip.duration;
  if (step > 0) {
    for (let t = step; t < clip.duration - 1e-4; t += step) times.push(t);
  }
  if (clip.duration > 0) times.push(Math.max(0, clip.duration - 1e-4));
  return times;
}

let authoredMin = Infinity;
const authoredByClip: Record<string, number> = {};
for (const [name, clip] of clips) {
  let clipMin = Infinity;
  for (const time of sampleTimes(clip)) {
    gltf.scene.position.set(0, 0, 0);
    gltf.scene.rotation.set(0, 0, 0);
    poseClip(mixer, clip, time);
    gltf.scene.updateMatrixWorld(true);
    const y = minSkinnedY(skinned);
    if (y < clipMin) clipMin = y;
  }
  authoredByClip[name] = clipMin;
  if (clipMin < authoredMin) authoredMin = clipMin;
  console.log(`authored ${name} ${clip.duration.toFixed(3)}s minY ${clipMin.toFixed(4)}`);
}

const flapSigns = [-POSE_LIMITS.flapMax, POSE_LIMITS.flapMax];
const tiltSigns = [-POSE_LIMITS.headTiltMax, POSE_LIMITS.headTiltMax];
const lookSigns = [-POSE_LIMITS.lookMax, POSE_LIMITS.lookMax];
const rollSigns = [-POSE_LIMITS.rollMax, POSE_LIMITS.rollMax];
let proceduralMin = Infinity;
let worst = "";
for (const name of ["idle", "happy"] as const) {
  const clip = clips.get(name)!;
  for (const time of sampleTimes(clip)) {
    for (const flap of flapSigns) {
      for (const tilt of tiltSigns) {
        for (const look of lookSigns) {
          for (const roll of rollSigns) {
            gltf.scene.position.set(0, 0, 0);
            gltf.scene.rotation.set(0, 0, 0);
            poseClip(mixer, clip, time);
            applyAxis(flapL, axisL, -flap);
            applyAxis(flapR, axisR, -flap);
            applyAxis(head, AXIS_X, tilt);
            applyAxis(head, AXIS_Y, look);
            const sine = Math.sin(roll);
            gltf.scene.position.y = foot * (sine < 0 ? -sine : sine);
            gltf.scene.rotation.z = roll;
            gltf.scene.updateMatrixWorld(true);
            const y = minSkinnedY(skinned);
            if (y < proceduralMin) {
              proceduralMin = y;
              worst = `${name} t=${time.toFixed(2)} flap=${flap.toFixed(3)} tilt=${tilt.toFixed(3)} look=${look.toFixed(3)} roll=${roll.toFixed(3)}`;
            }
          }
        }
      }
    }
  }
}
gltf.scene.position.set(0, 0, 0);
gltf.scene.rotation.set(0, 0, 0);
poseClip(mixer, idle, 0);
gltf.scene.rotation.z = POSE_LIMITS.rollMax;
gltf.scene.updateMatrixWorld(true);
const sunk = minSkinnedY(skinned);
const rollSine = Math.sin(POSE_LIMITS.rollMax);
gltf.scene.position.y = foot * (rollSine < 0 ? -rollSine : rollSine);
gltf.scene.updateMatrixWorld(true);
const lifted = minSkinnedY(skinned);
console.log(`roll without lift minY ${sunk.toFixed(4)}  with lift ${lifted.toFixed(4)}`);
console.log(`procedural minY ${proceduralMin.toFixed(4)} at ${worst}`);
console.log(`authored floor ${authoredMin.toFixed(4)} allowance ${0.003}`);
if (!(proceduralMin >= authoredMin - 0.003)) {
  fail(`procedural pose sinks below the clips (${proceduralMin.toFixed(4)} < ${(authoredMin - 0.003).toFixed(4)})`);
}

const happyClip = clips.get("happy")!;
const idleAction = mixer.clipAction(idle);
const happyAction = mixer.clipAction(happyClip);
mixer.stopAllAction();
idleAction.setLoop(LoopRepeat, Infinity);
idleAction.reset();
idleAction.setEffectiveWeight(1);
idleAction.play();
happyAction.setLoop(LoopRepeat, Infinity);
happyAction.reset();
happyAction.setEffectiveWeight(1);
happyAction.play();
idleAction.crossFadeTo(happyAction, 0.28, false);
mixer.update(0.14);
const happyWeight = happyAction.getEffectiveWeight();
console.log(`happy weight mid-crossfade ${happyWeight.toFixed(3)}`);
if (happyWeight < 0.2) fail(`happy clip weight stayed near zero (${happyWeight.toFixed(3)})`);

const sim = new AliveController({ x: 0.85, z: 0.35, seed: 11 });
const input: AliveInput = {
  nowMs: 0,
  dt: 0.016,
  playerX: 0,
  playerZ: 0,
  playerVisible: true,
  camForwardX: 0,
  camForwardZ: -1,
  sleepRequested: false,
  summon: false,
  moodOverride: null,
};
const warmup = 200;
const n = 8000;
for (let i = 0; i < warmup; i++) sim.tick(input);
let maxUs = 0;
const benchStart = performance.now();
for (let i = 0; i < n; i++) {
  input.nowMs += 16;
  input.playerX = Math.sin(i / 40) * 3;
  input.playerZ = Math.cos(i / 50) * 2;
  input.sleepRequested = i > 4000 && i < 5000;
  const t0 = performance.now();
  sim.tick(input);
  const us = (performance.now() - t0) * 1000;
  if (us > maxUs) maxUs = us;
}
const meanUs = ((performance.now() - benchStart) / n) * 1000;
console.log(`tick mean ${meanUs.toFixed(1)} µs  max ${maxUs.toFixed(1)} µs  n=${n} after ${warmup} warmup`);

if (failures.length > 0) {
  for (const message of failures) console.error(`FAIL ${message}`);
  process.exit(1);
}
console.log("ball clip check ok");
