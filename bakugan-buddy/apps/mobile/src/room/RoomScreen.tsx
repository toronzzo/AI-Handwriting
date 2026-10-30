import { memo, useEffect, useRef, useState } from "react";
import { AppState, Platform, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import * as Network from "expo-network";
import {
  AnimationAction,
  AnimationMixer,
  LoopOnce,
  LoopRepeat,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  PointLight,
  SkinnedMesh,
  Vector3,
  type Group,
} from "three";
import type { GLTF } from "three/addons/loaders/GLTFLoader.js";
import {
  AliveController,
  BRAIN_MIN_INTERVAL_MS,
  EXPLORE_POINTS,
  FOLLOW_RING_RADIUS,
  POSE_LIMITS,
  createBrainAdvisor,
  type AliveInput,
  type AdvisorInput,
  type ClipName,
  type MindAdvisor,
  type Mood,
} from "../../../../packages/alive/src/index.ts";
import { fetchRemembered, findBrain, normalizeBrainUrl, probeBrain, readBrainHost, sendMoment, writeBrainHost } from "./brain/brainLink";
import { queueSpokenLine, VoiceSession } from "./voice/VoiceSession";
import { adviseOnDevice, onDeviceBrainEnabled } from "bakugan-on-device-brain";
import { Canvas, useFrame, useThree } from "./fiber";
import { loadPreyasBall } from "./loadPreyas";
import { applyAxis, closingHinge, floorLift, measureFootRadius, POSE_FADE_SEC } from "./poseRig";
import { readAliveMemory, writeAliveMemory } from "./persist";
import { applyMood, loadCompanionState } from "../state/emotionStore";
import { probeStudio, speakLine } from "./voice";

const MODEL_SCALE = 0.52;
const ROOM = 4.7;
const BARK_MS = 3400;
const SAVE_MS = 10_000;

const AXIS_X = new Vector3(1, 0, 0);
const AXIS_Y = new Vector3(0, 1, 0);
const LOOK_AT = new Vector3();

const CAMERA = { position: [0.2, 2.35, 3.6] as [number, number, number], fov: 42, near: 0.08, far: 40 };
const GL_PROPS = {
  antialias: false,
  alpha: false,
  powerPreference: "default" as const,
  failIfMajorPerformanceCaveat: false,
};

type PlayClip = ClipName | "open" | "close";
type Phase = "loop" | "closing" | "closed" | "opening";

type PlayerDrive = {
  x: number;
  z: number;
  vx: number;
  vz: number;
  auto: boolean;
  sleep: boolean;
  hidden: boolean;
  summonUntil: number;
  mood: Mood | null;
};

type BarkSink = {
  text: string;
  mood: Mood;
  until: number;
  gen: number;
};

type ReadoutSink = {
  skill: string;
  mood: string;
  hurry: boolean;
  scanning: boolean;
  notice01: number;
  noticed: boolean;
  advice: string | null;
  logCount: number;
};

type Sinks = {
  player: PlayerDrive;
  advisorRef: { current: MindAdvisor };
  sim: AliveController;
  bark: BarkSink;
  readout: ReadoutSink;
  lines: string[];
  clock0: number;
  booted: boolean;
  adviseAt: number;
  adviseBusy: boolean;
  frames: number;
  frameStamp: number;
  partnerName: string;
  facts: string[];
  brainUrl: string;
  streamText: string;
  streamGen: number;
  heard: string;
  hearLang: string;
  talkGen: number;
  talkEnv: number[];
  talkStart: number;
  talkUntil: number;
  talkAmp: number;
  spokenCount: number;
  stopTalk: (() => void) | null;
};

const MOODS: readonly Mood[] = ["neutral", "happy", "excited", "sad", "angry"];

function clamp(value: number, min: number, max: number): number {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

function approach(current: number, target: number, limit: number, dt: number): number {
  const maxStep = (limit * dt) / POSE_FADE_SEC;
  const delta = target - current;
  if (delta > maxStep) return current + maxStep;
  if (delta < -maxStep) return current - maxStep;
  return target;
}

function armClip(
  book: Partial<Record<PlayClip, AnimationAction>>,
  playing: { current: PlayClip },
  name: PlayClip,
  fade: number,
): boolean {
  const next = book[name];
  if (!next || playing.current === name) return next != null && playing.current === name;
  const once = name === "open" || name === "close";
  next.reset();
  next.enabled = true;
  next.setEffectiveWeight(1);
  next.clampWhenFinished = once;
  next.setLoop(once ? LoopOnce : LoopRepeat, once ? 1 : Infinity);
  next.play();
  const prev = book[playing.current];
  if (prev && prev !== next) {
    if (fade > 0) prev.crossFadeTo(next, fade, false);
    else prev.stop();
  }
  playing.current = name;
  return true;
}

function driveAuto(t: number, player: PlayerDrive): void {
  const u = t % 36;
  player.sleep = false;
  player.mood = null;
  player.hidden = false;
  if (u < 2.6) {
    player.x = 0;
    player.z = 0;
  } else if (u < 9) {
    const k = (u - 2.6) / 6.4;
    player.x = 3.3 * k;
    player.z = -2.5 * k;
  } else if (u < 17.5) {
    player.x = 3.3;
    player.z = -2.5;
  } else if (u < 22.5) {
    player.x = 3.3;
    player.z = -2.5;
    player.sleep = true;
  } else if (u < 28) {
    const k = (u - 22.5) / 5.5;
    player.x = 3.3 + (-2.4 - 3.3) * k;
    player.z = -2.5 + (2.3 + 2.5) * k;
  } else {
    player.x = -2.4;
    player.z = 2.3;
    if (u < 30.2) player.mood = "sad";
    else if (u < 32.2) player.mood = "angry";
    else if (u < 34.2) player.mood = "excited";
    else player.mood = "happy";
  }
}

function propFor(id: string) {
  if (id === "window") {
    return (
      <mesh position={[0, 0.75, 0]}>
        <boxGeometry args={[0.95, 1.15, 0.05]} />
        <meshStandardMaterial color="#b7dff2" emissive="#7eb4cc" emissiveIntensity={0.45} />
      </mesh>
    );
  }
  if (id === "shelf") {
    return (
      <mesh position={[0, 0.42, 0]}>
        <boxGeometry args={[0.7, 0.7, 0.28]} />
        <meshStandardMaterial color="#8d8680" />
      </mesh>
    );
  }
  if (id === "plant") {
    return (
      <group>
        <mesh position={[0, 0.22, 0]}>
          <cylinderGeometry args={[0.08, 0.1, 0.4, 10]} />
          <meshStandardMaterial color="#6d6258" />
        </mesh>
        <mesh position={[0, 0.55, 0]}>
          <sphereGeometry args={[0.22, 16, 12]} />
          <meshStandardMaterial color="#9aa8a0" />
        </mesh>
      </group>
    );
  }
  if (id === "door") {
    return (
      <mesh position={[0, 0.7, 0]}>
        <boxGeometry args={[0.55, 1.3, 0.06]} />
        <meshStandardMaterial color="#5c656e" />
      </mesh>
    );
  }
  return (
    <mesh position={[0, 0.08, 0]}>
      <sphereGeometry args={[0.22, 16, 10]} />
      <meshStandardMaterial color="#6f7c88" />
    </mesh>
  );
}

function RoomDressing() {
  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[12.6, 12.6]} />
        <meshStandardMaterial color="#3c4a58" />
      </mesh>
      <gridHelper args={[12, 12, "#445266", "#2c3642"]} position={[0, 0.01, 0]} />
      <mesh position={[0, 1.2, -5.9]}>
        <boxGeometry args={[12.4, 2.6, 0.16]} />
        <meshStandardMaterial color="#14181e" />
      </mesh>
      <mesh position={[0, 1.2, 5.9]}>
        <boxGeometry args={[12.4, 2.6, 0.16]} />
        <meshStandardMaterial color="#14181e" />
      </mesh>
      <mesh position={[-5.9, 1.2, 0]}>
        <boxGeometry args={[0.16, 2.6, 12.4]} />
        <meshStandardMaterial color="#12161b" />
      </mesh>
      <mesh position={[5.9, 1.2, 0]}>
        <boxGeometry args={[0.16, 2.6, 12.4]} />
        <meshStandardMaterial color="#12161b" />
      </mesh>
      {EXPLORE_POINTS.map((point) => (
        <group key={point.id} position={[point.x, 0, point.z]}>
          {propFor(point.id)}
          <mesh position={[0, 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]}>
            <circleGeometry args={[0.28, 18]} />
            <meshBasicMaterial color="#9ec4d6" transparent opacity={0.35} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

function makeSinks(): Sinks {
  return {
    player: {
      x: 0,
      z: 0,
      vx: 0,
      vz: 0,
      auto: false,
      sleep: false,
      hidden: false,
      summonUntil: 0,
      mood: null,
    },
    advisorRef: { current: { advise: async () => null } },
    sim: new AliveController({ x: 0.85, z: 0.35, seed: 11 }),
    bark: { text: "", mood: "neutral", until: 0, gen: 0 },
    readout: {
      skill: "idle-roll",
      mood: "neutral",
      hurry: false,
      scanning: false,
      notice01: 0,
      noticed: false,
      advice: null,
      logCount: 0,
    },
    lines: ["", "", ""],
    clock0: Date.now(),
    booted: false,
    adviseAt: 0,
    adviseBusy: false,
    frames: 0,
    frameStamp: Date.now(),
    partnerName: "partner",
    facts: [],
    brainUrl: "",
    streamText: "",
    streamGen: 0,
    heard: "",
    hearLang: "en",
    talkGen: 0,
    talkEnv: [],
    talkStart: 0,
    talkUntil: 0,
    talkAmp: 0,
    spokenCount: 0,
    stopTalk: null,
  };
}

const World = memo(function World({ sinks }: { sinks: Sinks }) {
  const [gltf, setGltf] = useState<GLTF | null>(null);
  const mixer = useRef<AnimationMixer | null>(null);
  const actions = useRef<Partial<Record<PlayClip, AnimationAction>>>({});
  const bones = useRef<Record<string, Object3D>>({});
  const eye = useRef<PointLight | null>(null);
  const rig = useRef<Group>(null);
  const puck = useRef<Mesh>(null);
  const ring = useRef<Mesh>(null);
  const blob = useRef<Mesh>(null);
  const hingeL = useRef(new Vector3(0, 0, 1));
  const hingeR = useRef(new Vector3(0, 0, 1));
  const footRadius = useRef(0.4);
  const phase = useRef<Phase>("loop");
  const playing = useRef<PlayClip>("idle");
  const wantLoop = useRef<ClipName>("idle");
  const finishKind = useRef(0);
  const shownFlap = useRef(0);
  const shownTilt = useRef(0);
  const shownLook = useRef(0);
  const input = useRef<AliveInput>({
    nowMs: 0,
    dt: 0,
    playerX: 0,
    playerZ: 0,
    playerVisible: true,
    camForwardX: -0.3,
    camForwardZ: -9.4,
    sleepRequested: false,
    summon: false,
    moodOverride: null,
  });
  const { camera } = useThree();

  useEffect(() => {
    let cancel = false;
    void loadPreyasBall()
      .then((loaded) => {
        if (cancel) return;
        let skinned: SkinnedMesh | null = null;
        loaded.scene.traverse((obj) => {
          if (obj.name) bones.current[obj.name] = obj;
          const skinnedMesh = obj as SkinnedMesh;
          if (skinnedMesh.isSkinnedMesh) skinned = skinnedMesh;
          const mesh = obj as Mesh;
          if (!mesh.isMesh) return;
          const material = mesh.material as MeshStandardMaterial;
          if (material && "vertexColors" in material) {
            material.vertexColors = true;
            material.roughness = 0.78;
            material.metalness = 0.02;
          }
        });
        const nextMixer = new AnimationMixer(loaded.scene);
        const book: Partial<Record<PlayClip, AnimationAction>> = {};
        for (const clip of loaded.animations) {
          const name = clip.name as PlayClip;
          const action = nextMixer.clipAction(clip);
          action.enabled = true;
          action.setEffectiveWeight(1);
          action.setLoop(LoopRepeat, Infinity);
          action.clampWhenFinished = false;
          book[name] = action;
        }
        const flapL = loaded.scene.getObjectByName("flapL");
        const flapR = loaded.scene.getObjectByName("flapR");
        const closeClip = loaded.animations.find((clip) => clip.name === "close");
        if (flapL && closeClip) closingHinge(flapL, nextMixer, closeClip, 0.4, hingeL.current);
        if (flapR && closeClip) closingHinge(flapR, nextMixer, closeClip, 0.4, hingeR.current);
        const idle = book.idle;
        if (idle) {
          idle.setLoop(LoopRepeat, Infinity);
          idle.clampWhenFinished = false;
          idle.reset();
          idle.setEffectiveWeight(1);
          idle.play();
          idle.time = 0;
          nextMixer.update(0);
          playing.current = "idle";
          phase.current = "loop";
        }
        if (skinned) footRadius.current = measureFootRadius(skinned, POSE_LIMITS.rollMax);
        const head = loaded.scene.getObjectByName("head");
        if (head && !head.getObjectByName("eye-glow")) {
          const light = new PointLight("#d5f3ff", 0.8, 2.4, 2);
          light.name = "eye-glow";
          light.position.set(0, 0.02, 0.18);
          head.add(light);
          eye.current = light;
        }
        nextMixer.addEventListener("finished", (event) => {
          const action = (event as { action?: AnimationAction }).action;
          if (!action) return;
          if (action === book.close) finishKind.current = 1;
          else if (action === book.open) finishKind.current = 2;
        });
        mixer.current = nextMixer;
        actions.current = book;
        setGltf(loaded);
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`preyas glb failed: ${message}`);
      });
    return () => {
      cancel = true;
      mixer.current?.stopAllAction();
      mixer.current = null;
      eye.current?.removeFromParent();
      eye.current = null;
    };
  }, []);

  useFrame((_, dt) => {
    const step = dt > 0.05 ? 0.05 : dt;
    const now = Date.now();
    const who = sinks.player;
    if (who.auto) driveAuto((now - sinks.clock0) / 1000, who);
    else {
      who.x = clamp(who.x + who.vx * 1.55 * step, -ROOM, ROOM);
      who.z = clamp(who.z + who.vz * 1.55 * step, -ROOM, ROOM);
    }
    if (puck.current) {
      puck.current.position.x = who.x;
      puck.current.position.z = who.z;
    }
    if (ring.current) {
      ring.current.position.x = who.x;
      ring.current.position.z = who.z;
    }
    sinks.frames += 1;

    if (!sinks.booted) return;

    const frameIn = input.current;
    frameIn.nowMs = now;
    frameIn.dt = step;
    frameIn.playerX = who.x;
    frameIn.playerZ = who.z;
    frameIn.playerVisible = !who.hidden;
    frameIn.sleepRequested = who.sleep;
    frameIn.summon = who.summonUntil > now;
    frameIn.moodOverride = who.mood;
    const frame = sinks.sim.tick(frameIn);

    const root = rig.current;
    if (root) {
      const lift = floorLift(frame.roll, footRadius.current, MODEL_SCALE);
      let talk = 0;
      if (now < sinks.talkUntil && sinks.talkEnv.length > 0) {
        const index = ((now - sinks.talkStart) / 20) | 0;
        const sample = index >= 0 && index < sinks.talkEnv.length ? sinks.talkEnv[index] : 0;
        talk = sample ?? 0;
      }
      sinks.talkAmp = talk;
      root.position.set(frame.x, frame.bob + frame.hop + lift + talk * 0.03, frame.z);
      root.rotation.order = "YXZ";
      root.rotation.x = 0;
      root.rotation.y = frame.yaw;
      root.rotation.z = frame.roll;
    }
    if (blob.current) {
      blob.current.position.x = frame.x;
      blob.current.position.z = frame.z;
      const squash = 1 - frame.hop * 2.2;
      blob.current.scale.setScalar(squash > 0.7 ? squash : 0.7);
    }

    const mix = mixer.current;
    if (mix) {
      const book = actions.current;
      if (frame.clip === "closed") {
        if (phase.current === "loop" || phase.current === "opening") {
          if (armClip(book, playing, "close", 0.16)) phase.current = "closing";
        }
      } else if (phase.current === "closing" || phase.current === "closed") {
        wantLoop.current = frame.clip;
        if (armClip(book, playing, "open", 0.16)) phase.current = "opening";
      } else if (phase.current === "opening") {
        wantLoop.current = frame.clip;
      } else if (frame.clip !== playing.current) {
        armClip(book, playing, frame.clip, POSE_FADE_SEC);
      }

      mix.update(step);

      if (finishKind.current === 1 && phase.current === "closing") {
        phase.current = "closed";
        armClip(book, playing, "closed", 0.08);
      } else if (finishKind.current === 2 && phase.current === "opening") {
        phase.current = "loop";
        armClip(book, playing, wantLoop.current, POSE_FADE_SEC);
      }
      finishKind.current = 0;

      const live = phase.current === "loop" ? 1 : 0;
      shownFlap.current = approach(shownFlap.current, frame.flap * live, POSE_LIMITS.flapMax, step);
      shownTilt.current = approach(shownTilt.current, frame.headTilt * live, POSE_LIMITS.headTiltMax, step);
      shownLook.current = approach(shownLook.current, frame.look * live, POSE_LIMITS.lookMax, step);
      const flapL = bones.current.flapL;
      const flapR = bones.current.flapR;
      const head = bones.current.head;
      const face = bones.current.faceplate;
      if (flapL) applyAxis(flapL, hingeL.current, -shownFlap.current);
      if (flapR) applyAxis(flapR, hingeR.current, -shownFlap.current);
      if (head) {
        applyAxis(head, AXIS_X, shownTilt.current);
        applyAxis(head, AXIS_Y, shownLook.current);
      }
      if (face && sinks.talkAmp > 0.02) applyAxis(face, AXIS_X, sinks.talkAmp * 0.18);
    }
    if (eye.current) eye.current.intensity = 0.12 + frame.eye * 1.5;

    const lookX = who.x * 0.42 + frame.x * 0.58;
    const lookZ = who.z * 0.42 + frame.z * 0.58;
    camera.position.set(lookX + 0.15, 2.35, lookZ + 3.6);
    LOOK_AT.set(lookX, 0.42, lookZ);
    camera.lookAt(LOOK_AT);

    const hud = sinks.readout;
    hud.skill = frame.skill;
    hud.mood = frame.mood;
    hud.hurry = frame.hurry;
    hud.scanning = frame.scanning;
    hud.notice01 = frame.notice01;
    hud.noticed = frame.noticedPlayer;
    hud.advice = frame.adviceGoal;
    hud.logCount = frame.logCount;
    const bark = sinks.bark;
    if (frame.bark) {
      bark.text = frame.bark;
      bark.mood = frame.mood;
      bark.until = now + BARK_MS;
      bark.gen += 1;
    } else if (bark.text.length > 0 && now > bark.until) {
      bark.text = "";
      bark.gen += 1;
    }
  });

  return (
    <group>
      <color attach="background" args={["#24303c"]} />
      <hemisphereLight args={["#f4f7fb", "#2a3844", 0.95]} />
      <ambientLight intensity={0.45} color="#e7eef5" />
      <directionalLight position={[3.4, 6.2, 2.6]} intensity={2.2} color="#ffffff" />
      <directionalLight position={[-4.2, 2.4, -1.6]} intensity={0.55} color="#b7d7ee" />
      <RoomDressing />
      <mesh ref={ring} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.025, 0]}>
        <ringGeometry args={[FOLLOW_RING_RADIUS - 0.045, FOLLOW_RING_RADIUS + 0.045, 56]} />
        <meshBasicMaterial color="#8ec8ff" transparent opacity={0.5} />
      </mesh>
      <mesh ref={puck} position={[0, 0.16, 0]}>
        <sphereGeometry args={[0.16, 18, 14]} />
        <meshStandardMaterial color="#f4f7fb" emissive="#9eb0c4" emissiveIntensity={0.35} />
      </mesh>
      <mesh ref={blob} rotation={[-Math.PI / 2, 0, 0]} position={[1.7, 0.012, 0.5]}>
        <circleGeometry args={[0.46, 24]} />
        <meshBasicMaterial color="#05070a" transparent opacity={0.38} />
      </mesh>
      <group ref={rig} position={[0.85, 0, 0.35]} scale={MODEL_SCALE}>
        {gltf ? (
          <primitive object={gltf.scene} />
        ) : (
          <mesh>
            <sphereGeometry args={[1.55, 28, 18]} />
            <meshStandardMaterial color="#c4c4c4" roughness={0.7} />
          </mesh>
        )}
      </group>
    </group>
  );
});

type ReadoutState = ReadoutSink & { fps: number; lines: string[] };

export function RoomScreen() {
  const sinks = useRef<Sinks | null>(null);
  if (sinks.current === null) sinks.current = makeSinks();
  const bag = sinks.current;
  const [debug, setDebug] = useState(typeof __DEV__ !== "undefined" && __DEV__);
  const [bark, setBark] = useState<string | null>(null);
  const [hud, setHud] = useState<ReadoutState>({
    skill: "idle-roll",
    mood: "neutral",
    hurry: false,
    scanning: false,
    notice01: 0,
    noticed: false,
    advice: null,
    logCount: 0,
    fps: 0,
    lines: [],
  });
  const [tick, setTick] = useState(0);
  void tick;
  const [brainHost, setBrainHost] = useState("");
  const [brainStatus, setBrainStatus] = useState("barks");
  bag.brainUrl = normalizeBrainUrl(brainHost);

  useEffect(() => {
    let cancel = false;
    void readBrainHost().then((saved) => {
      if (cancel) return;
      if (saved) setBrainHost(saved);
      else if (process.env.EXPO_PUBLIC_BRAIN_URL) setBrainHost(process.env.EXPO_PUBLIC_BRAIN_URL);
    });
    return () => {
      cancel = true;
    };
  }, []);

  useEffect(() => {
    const url = normalizeBrainUrl(brainHost);
    const remote: MindAdvisor = url
      ? createBrainAdvisor({
          baseUrl: url,
          onPartial: (line) => {
            bag.streamText = line;
            bag.streamGen += 1;
            queueSpokenLine(bag, line, bag.readout.mood, false);
          },
        })
      : { advise: async () => null };
    bag.advisorRef.current = {
      async advise(input) {
        if (onDeviceBrainEnabled) {
          const local = await adviseOnDevice(input);
          if (local) return local;
        }
        return remote.advise(input);
      },
    };
    if (!url) {
      setBrainStatus(onDeviceBrainEnabled ? "on device" : "barks");
      return;
    }
    let cancel = false;
    void probeBrain(url).then((ok) => {
      if (!cancel) setBrainStatus(ok ? "connected" : "offline, barks");
    });
    return () => {
      cancel = true;
    };
  }, [bag, brainHost]);

  useEffect(() => {
    let cancel = false;
    const timer = setTimeout(() => {
      bag.booted = true;
    }, 1200);
    void Promise.all([readAliveMemory(), loadCompanionState().catch(() => null)]).then(([json, state]) => {
      if (cancel) return;
      if (json) bag.sim.loadSnapshot(json);
      if (state) {
        bag.sim.seedMood(state.emotion.mood);
        bag.readout.mood = state.emotion.mood;
        bag.partnerName = state.partnerName || "partner";
        bag.facts = state.facts.slice(-6);
      }
      bag.booted = true;
      clearTimeout(timer);
    });
    return () => {
      cancel = true;
      clearTimeout(timer);
    };
  }, [bag]);

  useEffect(() => {
    void probeStudio();
  }, []);

  useEffect(() => {
    const save = () => {
      if (!bag.booted) return;
      const json = bag.sim.exportSnapshot();
      void writeAliveMemory(json);
      if (bag.brainUrl) {
        void fetch(`${bag.brainUrl}/v1/memory`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: json,
        }).catch(() => {});
      }
      void loadCompanionState()
        .then((state) => {
          bag.partnerName = state.partnerName || "partner";
          bag.facts = state.facts.slice(-6);
        })
        .catch(() => {});
    };
    const interval = setInterval(save, SAVE_MS);
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "background" || state === "inactive") save();
    });
    return () => {
      clearInterval(interval);
      sub.remove();
      save();
    };
  }, [bag]);

  useEffect(() => {
    let seen = bag.bark.gen;
    let seenStream = bag.streamGen;
    const interval = setInterval(() => {
      const now = Date.now();
      if (bag.booted && now - bag.adviseAt > BRAIN_MIN_INTERVAL_MS && !bag.adviseBusy) {
        bag.adviseAt = now;
        bag.adviseBusy = true;
        const snap: AdvisorInput = bag.sim.advisorSnapshot();
        snap.partnerName = bag.partnerName;
        snap.heard = bag.heard;
        bag.heard = "";
        const adviseWith = (remembered: string[]) => {
          const local = bag.facts;
          const combined: string[] = [];
          for (let i = 0; i < remembered.length; i++) combined.push(remembered[i]!);
          for (let i = 0; i < local.length && combined.length < 8; i++) combined.push(local[i]!);
          snap.facts = combined;
          void bag.advisorRef.current.advise(snap).then(
            (suggestion) => {
              bag.sim.offerAdvice(suggestion, Date.now());
              if (suggestion?.line) {
                queueSpokenLine(bag, suggestion.line, suggestion.mood, true);
                if (bag.brainUrl) {
                  sendMoment(
                    bag.brainUrl,
                    JSON.stringify({
                      line: suggestion.line,
                      mood: suggestion.mood,
                      events: snap.events.slice(-6),
                    }),
                  );
                }
              } else if (snap.heard) {
                bag.heard = snap.heard;
              }
              bag.adviseBusy = false;
            },
            () => {
              bag.adviseBusy = false;
            },
          );
        };
        if (bag.brainUrl) {
          void fetchRemembered(bag.brainUrl, `${snap.skill} ${snap.mood}`).then(adviseWith, () => adviseWith([]));
        } else {
          adviseWith([]);
        }
      }
      if (bag.streamGen !== seenStream) {
        seenStream = bag.streamGen;
        if (bag.streamText) setBark(bag.streamText);
      }
      if (bag.bark.gen === seen) return;
      seen = bag.bark.gen;
      const text = bag.bark.text;
      setBark(text.length > 0 ? text : null);
      if (text.length > 0) speakLine(text, bag.bark.mood);
    }, 100);
    return () => clearInterval(interval);
  }, [bag]);

  useEffect(() => {
    if (!debug) return;
    const interval = setInterval(() => {
      const now = Date.now();
      const elapsed = (now - bag.frameStamp) / 1000;
      const fps = elapsed > 0 ? Math.round(bag.frames / elapsed) : 0;
      bag.frames = 0;
      bag.frameStamp = now;
      bag.sim.writeNewest(3, bag.lines);
      const readout = bag.readout;
      const lines = bag.lines.filter((line) => line.length > 0);
      setHud({
        skill: readout.skill,
        mood: readout.mood,
        hurry: readout.hurry,
        scanning: readout.scanning,
        notice01: readout.notice01,
        noticed: readout.noticed,
        advice: readout.advice,
        logCount: readout.logCount,
        fps,
        lines,
      });
    }, 250);
    return () => clearInterval(interval);
  }, [bag, debug]);

  useEffect(() => {
    if (Platform.OS !== "web" || typeof window === "undefined") return;
    const down = (event: KeyboardEvent) => {
      if (event.repeat) return;
      const player = bag.player;
      if (event.key === "ArrowLeft" || event.key === "a") player.vx = -1;
      if (event.key === "ArrowRight" || event.key === "d") player.vx = 1;
      if (event.key === "ArrowUp" || event.key === "w") player.vz = -1;
      if (event.key === "ArrowDown" || event.key === "s") player.vz = 1;
      if (event.key.startsWith("Arrow") || "wasd".includes(event.key)) {
        player.auto = false;
        if (debug) setTick((n) => n + 1);
      }
    };
    const up = (event: KeyboardEvent) => {
      const player = bag.player;
      if (event.key === "ArrowLeft" || event.key === "a" || event.key === "ArrowRight" || event.key === "d") {
        player.vx = 0;
      }
      if (event.key === "ArrowUp" || event.key === "w" || event.key === "ArrowDown" || event.key === "s") {
        player.vz = 0;
      }
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, [bag, debug]);

  const refresh = () => setTick((n) => n + 1);
  const player = bag.player;
  const skillLabel =
    hud.skill === "idle-roll" ? "idle roll" : hud.hurry ? "hurry" : hud.scanning ? "looking" : hud.skill;

  return (
    <View style={styles.root}>
      <View style={styles.stage}>
        <Canvas style={styles.canvas} dpr={[1, 1.5]} camera={CAMERA} gl={GL_PROPS}>
          <World sinks={bag} />
        </Canvas>
        <VoiceSession sinks={bag} />
        <Pressable
          accessibilityLabel="debug"
          delayLongPress={700}
          onLongPress={() => setDebug((value) => !value)}
          style={styles.debugHit}
        />
        {debug && (
          <View pointerEvents="none" style={styles.readout}>
            <Text style={styles.name}>PREYAS</Text>
            <Text style={styles.meta}>
              {skillLabel} · {hud.mood}
              {hud.fps > 0 ? ` · ${hud.fps} fps` : ""}
            </Text>
            {!hud.noticed && (
              <View style={styles.noticeTrack}>
                <View style={[styles.noticeFill, { width: `${Math.round(hud.notice01 * 100)}%` }]} />
              </View>
            )}
            {hud.advice && hud.advice !== hud.skill && (
              <Text style={styles.advice}>advisor said {hud.advice}</Text>
            )}
            <Text style={styles.memory}>remembers {hud.logCount}</Text>
            {hud.lines.map((line, index) => (
              <Text key={`${index}-${line}`} style={styles.log} numberOfLines={1}>
                {line}
              </Text>
            ))}
          </View>
        )}
        {bark && (
          <View pointerEvents="none" style={styles.bubble}>
            <Text style={styles.bubbleText}>{bark}</Text>
          </View>
        )}
      </View>
      <View style={styles.brainRow}>
        <TextInput
          value={brainHost}
          onChangeText={setBrainHost}
          onEndEditing={() => {
            const url = normalizeBrainUrl(brainHost);
            setBrainHost(url);
            void writeBrainHost(url);
          }}
          autoCapitalize="none"
          autoCorrect={false}
          placeholder="Mac :8788 or LiteLLM :4000"
          placeholderTextColor="#7d8792"
          style={styles.brainInput}
        />
        <Pressable
          style={styles.pad}
          onPress={() => {
            void (async () => {
              setBrainStatus("looking");
              let localIp: string | null = null;
              try {
                localIp = await Network.getIpAddressAsync();
              } catch {
                localIp = null;
              }
              const found = await findBrain({
                saved: brainHost,
                envUrl: process.env.EXPO_PUBLIC_BRAIN_URL,
                localIp,
              });
              if (found) {
                setBrainHost(found);
                void writeBrainHost(found);
                setBrainStatus("connected");
              } else {
                setBrainStatus("offline, barks");
              }
            })();
          }}
        >
          <Text style={styles.padText}>find</Text>
        </Pressable>
        <Text style={styles.brainStatus}>{brainStatus}</Text>
      </View>
      {debug && (
        <View style={styles.controls}>
          <View style={styles.row}>
            {(
              [
                ["left", -1, 0],
                ["up", 0, -1],
                ["down", 0, 1],
                ["right", 1, 0],
              ] as const
            ).map(([label, vx, vz]) => (
              <Pressable
                key={label}
                style={styles.pad}
                onPressIn={() => {
                  player.auto = false;
                  if (vx !== 0) player.vx = vx;
                  if (vz !== 0) player.vz = vz;
                  refresh();
                }}
                onPressOut={() => {
                  if (vx !== 0) player.vx = 0;
                  if (vz !== 0) player.vz = 0;
                }}
              >
                <Text style={styles.padText}>{label}</Text>
              </Pressable>
            ))}
            <Pressable
              style={[styles.pad, player.auto && styles.padOn]}
              onPress={() => {
                player.auto = !player.auto;
                if (player.auto) {
                  player.mood = null;
                  player.sleep = false;
                  player.hidden = false;
                  bag.clock0 = Date.now();
                }
                refresh();
              }}
            >
              <Text style={styles.padText}>{player.auto ? "auto on" : "auto"}</Text>
            </Pressable>
          </View>
          <View style={styles.row}>
            <Pressable
              style={styles.pad}
              onPress={() => {
                player.auto = false;
                player.sleep = !player.sleep;
                if (!player.sleep) bag.sim.clearAdvice();
                refresh();
              }}
            >
              <Text style={styles.padText}>{player.sleep ? "wake" : "sleep"}</Text>
            </Pressable>
            <Pressable
              style={styles.pad}
              onPress={() => {
                player.auto = false;
                player.summonUntil = Date.now() + 1400;
                player.hidden = false;
                refresh();
              }}
            >
              <Text style={styles.padText}>call</Text>
            </Pressable>
            <Pressable
              style={styles.pad}
              onPress={() => {
                player.auto = false;
                player.hidden = !player.hidden;
                refresh();
              }}
            >
              <Text style={styles.padText}>{player.hidden ? "return" : "step out"}</Text>
            </Pressable>
            {MOODS.map((mood) => (
              <Pressable
                key={mood}
                style={[styles.pad, player.mood === mood && styles.padOn]}
                onPress={() => {
                  player.auto = false;
                  const next = player.mood === mood ? null : mood;
                  player.mood = next;
                  if (next) {
                    bag.sim.seedMood(next);
                    void applyMood(next, 1);
                  }
                  refresh();
                }}
              >
                <Text style={styles.padText}>{mood}</Text>
              </Pressable>
            ))}
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#10141a" },
  stage: { flex: 1 },
  canvas: { flex: 1 },
  debugHit: { position: "absolute", top: 0, right: 0, width: 56, height: 56 },
  brainRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: "#10141a",
  },
  brainInput: {
    flex: 1,
    color: "#e8e8e8",
    fontSize: 12,
    paddingVertical: 6,
    paddingHorizontal: 8,
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1,
    borderColor: "rgba(200,200,200,0.28)",
  },
  brainStatus: { color: "#8b97a3", fontSize: 11, width: 92 },
  readout: {
    position: "absolute",
    top: 8,
    left: 10,
    maxWidth: 280,
    backgroundColor: "rgba(8,12,16,0.82)",
    paddingVertical: 8,
    paddingHorizontal: 10,
  },
  name: { color: "#f2f2f2", fontWeight: "800", letterSpacing: 1.5, fontSize: 13 },
  meta: { color: "#d5dde6", fontSize: 13, marginTop: 2 },
  advice: { color: "#9ec4d6", fontSize: 12, marginTop: 2 },
  memory: { color: "#8b97a3", fontSize: 11, marginTop: 2 },
  log: { color: "#aeb8c2", fontSize: 11, marginTop: 1 },
  noticeTrack: {
    marginTop: 6,
    height: 4,
    width: 120,
    backgroundColor: "rgba(255,255,255,0.12)",
  },
  noticeFill: { height: 4, backgroundColor: "#d5f3ff" },
  bubble: {
    position: "absolute",
    left: 16,
    right: 16,
    bottom: 12,
    backgroundColor: "rgba(12,16,20,0.88)",
    borderColor: "rgba(200,220,230,0.35)",
    borderWidth: 1,
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  bubbleText: { color: "#f4f7fb", fontSize: 14, lineHeight: 19 },
  controls: {
    paddingHorizontal: 8,
    paddingTop: 6,
    paddingBottom: 8,
    gap: 6,
    borderTopWidth: 1,
    borderTopColor: "rgba(200,200,200,0.18)",
  },
  row: { flexDirection: "row", flexWrap: "wrap", gap: 6, justifyContent: "center" },
  pad: {
    paddingVertical: 7,
    paddingHorizontal: 9,
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1,
    borderColor: "rgba(200,200,200,0.28)",
  },
  padOn: { borderColor: "#f2f2f2", backgroundColor: "rgba(255,255,255,0.14)" },
  padText: { color: "#e8e8e8", fontSize: 12, fontWeight: "600" },
});
