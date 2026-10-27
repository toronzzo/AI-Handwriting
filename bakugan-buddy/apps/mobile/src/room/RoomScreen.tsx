import { useEffect, useRef, useState } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import {
  AnimationAction,
  AnimationMixer,
  LoopRepeat,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  PointLight,
  type Group,
} from "three";
import type { GLTF } from "three/addons/loaders/GLTFLoader.js";
import {
  AliveController,
  EXPLORE_POINTS,
  FOLLOW_RING_RADIUS,
  MockMindAdvisor,
  chainAdvisors,
  createStudioAdvisor,
  type AliveFrame,
  type AliveInput,
  type MindAdvisor,
  type Mood,
} from "../../../../packages/alive/src/index.ts";
import { loadPreyasBall } from "./loadPreyas";
import { readAliveMemory, writeAliveMemory } from "./persist";
import { probeStudio, speakLine } from "./voice";

const MODEL_SCALE = 0.52;
const ROOM = 4.7;

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

type HudState = {
  skill: string;
  mood: string;
  hurry: boolean;
  scanning: boolean;
  notice01: number;
  noticed: boolean;
  advice: string | null;
  bark: string | null;
  lines: string[];
  logCount: number;
  auto: boolean;
};

const MOODS: readonly Mood[] = ["neutral", "happy", "excited", "sad", "angry"];

function clamp(value: number, min: number, max: number): number {
  if (value < min) return min;
  if (value > max) return max;
  return value;
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

type WorldProps = {
  player: PlayerDrive;
  onHud: (frame: AliveFrame, a: string, b: string, c: string) => void;
  onBarkClear: () => void;
  onFps: (fps: number) => void;
  advisorRef: { current: MindAdvisor };
};

function World({ player, onHud, onBarkClear, onFps, advisorRef }: WorldProps) {
  const sim = useRef<AliveController | null>(null);
  if (sim.current === null) {
    sim.current = new AliveController({ x: 0.85, z: 0.35, seed: 11 });
  }
  const booted = useRef(false);
  const [gltf, setGltf] = useState<GLTF | null>(null);
  const mixer = useRef<AnimationMixer | null>(null);
  const actions = useRef<Record<string, AnimationAction>>({});
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clipName = useRef("idle");
  const bones = useRef<Record<string, Object3D>>({});
  const eye = useRef<PointLight | null>(null);
  const rig = useRef<Group>(null);
  const puck = useRef<Mesh>(null);
  const ring = useRef<Mesh>(null);
  const blob = useRef<Mesh>(null);
  const onHudRef = useRef(onHud);
  onHudRef.current = onHud;
  const onClearRef = useRef(onBarkClear);
  onClearRef.current = onBarkClear;
  const onFpsRef = useRef(onFps);
  onFpsRef.current = onFps;
  const playerRef = useRef(player);
  playerRef.current = player;
  const adviseAt = useRef(0);
  const adviseBusy = useRef(false);
  const lastRev = useRef(0);
  const barkUntil = useRef(0);
  const lineBuf = useRef<string[]>(["", "", ""]);
  const fps = useRef({ frames: 0, t: performance.now() / 1000, last: -1, t0: performance.now() });
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
    const timer = setTimeout(() => {
      booted.current = true;
    }, 1200);
    void readAliveMemory().then((json) => {
      if (cancel) return;
      if (json) sim.current?.loadSnapshot(json);
      booted.current = true;
      clearTimeout(timer);
    });
    return () => {
      cancel = true;
      clearTimeout(timer);
    };
  }, []);

  useEffect(() => {
    let cancel = false;
    void loadPreyasBall()
      .then((loaded) => {
        if (cancel) return;
        loaded.scene.traverse((obj) => {
          if (obj.name) bones.current[obj.name] = obj;
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
        const book: typeof actions.current = {};
        for (const clip of loaded.animations) {
          const action = nextMixer.clipAction(clip);
          action.setLoop(LoopRepeat, Infinity);
          action.play();
          action.setEffectiveWeight(clip.name === "idle" ? 1 : 0);
          book[clip.name] = action;
        }
        const head = loaded.scene.getObjectByName("head");
        if (head && !head.getObjectByName("eye-glow")) {
          const light = new PointLight("#d5f3ff", 0.8, 2.4, 2);
          light.name = "eye-glow";
          light.position.set(0, 0.02, 0.18);
          head.add(light);
          eye.current = light;
        }
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
    const body = sim.current;
    if (!body) return;
    const who = playerRef.current;
    const step = dt > 0.05 ? 0.05 : dt;
    const demoNow = (performance.now() - fps.current.t0) / 1000;
    if (who.auto) driveAuto(demoNow, who);
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

    if (!booted.current) return;

    const frameIn = input.current;
    frameIn.nowMs = Date.now();
    frameIn.dt = dt;
    frameIn.playerX = who.x;
    frameIn.playerZ = who.z;
    frameIn.playerVisible = !who.hidden;
    frameIn.sleepRequested = who.sleep;
    frameIn.summon = who.summonUntil > frameIn.nowMs;
    frameIn.moodOverride = who.mood;
    const frame = body.tick(frameIn);

    const root = rig.current;
    if (root) {
      root.position.set(frame.x, frame.bob + frame.hop, frame.z);
      root.rotation.order = "YXZ";
      root.rotation.x = frame.headTilt;
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
      mix.update(step);
      const nextClip = frame.clip;
      if (nextClip !== clipName.current && actions.current[nextClip]) {
        actions.current[nextClip]!.reset().fadeIn(0.28).play();
        actions.current[clipName.current]?.fadeOut(0.28);
        clipName.current = nextClip;
      }
      if (frame.clip !== "closed") {
        bones.current.flapL?.rotateZ(frame.flap);
        bones.current.flapR?.rotateZ(-frame.flap);
        bones.current.head?.rotateY(frame.look);
      }
    }
    if (eye.current) eye.current.intensity = 0.12 + frame.eye * 1.5;

    const lookX = who.x * 0.42 + frame.x * 0.58;
    const lookZ = who.z * 0.42 + frame.z * 0.58;
    camera.position.set(lookX + 0.15, 2.35, lookZ + 3.6);
    camera.lookAt(lookX, 0.42, lookZ);

    if (frame.rev !== lastRev.current) {
      lastRev.current = frame.rev;
      const lines = lineBuf.current;
      body.writeNewest(3, lines);
      onHudRef.current(frame, lines[0] ?? "", lines[1] ?? "", lines[2] ?? "");
      if (frame.bark) barkUntil.current = performance.now() + 3400;
      if (saveTimer.current) clearTimeout(saveTimer.current);
      const json = body.exportSnapshot();
      saveTimer.current = setTimeout(() => {
        void writeAliveMemory(json);
      }, 450);
    } else if (barkUntil.current && performance.now() > barkUntil.current) {
      barkUntil.current = 0;
      onClearRef.current();
    }

    const clock = fps.current;
    clock.frames += 1;
    const wall = performance.now() / 1000;
    if (wall - clock.t >= 0.5) {
      const rate = clock.frames / (wall - clock.t);
      clock.frames = 0;
      clock.t = wall;
      const rounded = Math.round(rate);
      if (rounded !== clock.last) {
        clock.last = rounded;
        onFpsRef.current(rounded);
      }
    }

    if (demoNow - adviseAt.current > 4 && !adviseBusy.current) {
      adviseAt.current = demoNow;
      adviseBusy.current = true;
      const snap = body.advisorSnapshot();
      void advisorRef.current.advise(snap).then(
        (suggestion) => {
          body.offerAdvice(suggestion, Date.now());
          adviseBusy.current = false;
        },
        () => {
          adviseBusy.current = false;
        },
      );
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
}

export function RoomScreen() {
  const player = useRef<PlayerDrive>({
    x: 0,
    z: 0,
    vx: 0,
    vz: 0,
    auto: true,
    sleep: false,
    hidden: false,
    summonUntil: 0,
    mood: null,
  }).current;
  const advisorRef = useRef<MindAdvisor>(new MockMindAdvisor());
  const [hud, setHud] = useState<HudState>({
    skill: "idle roll",
    mood: "neutral",
    hurry: false,
    scanning: false,
    notice01: 0,
    noticed: false,
    advice: null,
    bark: null,
    lines: [],
    logCount: 0,
    auto: true,
  });
  const [fps, setFps] = useState(0);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let cancel = false;
    void probeStudio().then((url) => {
      if (cancel || !url) return;
      advisorRef.current = chainAdvisors(createStudioAdvisor(url), new MockMindAdvisor());
    });
    return () => {
      cancel = true;
    };
  }, []);

  useEffect(() => {
    if (Platform.OS !== "web" || typeof window === "undefined") return;
    const down = (event: KeyboardEvent) => {
      if (event.repeat) return;
      if (event.key === "ArrowLeft" || event.key === "a") player.vx = -1;
      if (event.key === "ArrowRight" || event.key === "d") player.vx = 1;
      if (event.key === "ArrowUp" || event.key === "w") player.vz = -1;
      if (event.key === "ArrowDown" || event.key === "s") player.vz = 1;
      if (event.key.startsWith("Arrow") || "wasd".includes(event.key)) {
        player.auto = false;
        setTick((n) => n + 1);
      }
    };
    const up = (event: KeyboardEvent) => {
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
  }, [player]);

  const refresh = () => setTick((n) => n + 1);

  const skillLabel =
    hud.skill === "idle-roll" ? "idle roll" : hud.hurry ? "hurry" : hud.scanning ? "looking" : hud.skill;

  return (
    <View style={styles.root}>
      <View style={styles.stage}>
        <Canvas
          style={styles.canvas}
          dpr={[1, 1.5]}
          camera={{ position: [0.2, 2.35, 3.6], fov: 42, near: 0.08, far: 40 }}
          gl={{
            antialias: false,
            alpha: false,
            powerPreference: "default",
            failIfMajorPerformanceCaveat: false,
          }}
        >
          <World
            player={player}
            advisorRef={advisorRef}
            onFps={setFps}
            onBarkClear={() => setHud((prev) => (prev.bark ? { ...prev, bark: null } : prev))}
            onHud={(frame, a, b, c) => {
              if (frame.bark) speakLine(frame.bark, frame.mood);
              setHud((prev) => ({
                skill: frame.skill,
                mood: frame.mood,
                hurry: frame.hurry,
                scanning: frame.scanning,
                notice01: frame.notice01,
                noticed: frame.noticedPlayer,
                advice: frame.adviceGoal,
                bark: frame.bark ?? prev.bark,
                lines: [a, b, c].filter((line) => line.length > 0),
                logCount: frame.logCount,
                auto: player.auto,
              }));
            }}
          />
        </Canvas>
        <View pointerEvents="none" style={styles.readout}>
          <Text style={styles.name}>PREYAS</Text>
          <Text style={styles.meta}>
            {skillLabel} · {hud.mood}
            {fps > 0 ? ` · ${fps} fps` : ""}
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
        {hud.bark && (
          <View pointerEvents="none" style={styles.bubble}>
            <Text style={styles.bubbleText}>{hud.bark}</Text>
          </View>
        )}
      </View>
      <View style={styles.controls}>
        <View style={styles.row}>
          {(
            [
              ["left", () => (player.vx = -1), () => (player.vx = 0)],
              ["up", () => (player.vz = -1), () => (player.vz = 0)],
              ["down", () => (player.vz = 1), () => (player.vz = 0)],
              ["right", () => (player.vx = 1), () => (player.vx = 0)],
            ] as const
          ).map(([label, start, stop]) => (
            <Pressable
              key={label}
              style={styles.pad}
              onPressIn={() => {
                player.auto = false;
                start();
                refresh();
              }}
              onPressOut={() => stop()}
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
                player.mood = player.mood === mood ? null : mood;
                refresh();
              }}
            >
              <Text style={styles.padText}>{mood}</Text>
            </Pressable>
          ))}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#10141a" },
  stage: { flex: 1 },
  canvas: { flex: 1 },
  readout: { position: "absolute", top: 8, left: 10, right: 10 },
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
