import { useEffect, useMemo, useRef, useState } from "react";
import { StyleSheet, View } from "react-native";
import {
  AnimationMixer,
  Box3,
  LoopOnce,
  LoopRepeat,
  Vector3,
  type AnimationAction,
  type Group,
  type Mesh,
} from "three";
import type { GLTF } from "three/addons/loaders/GLTFLoader.js";
import { Canvas, useFrame, useThree } from "../room/fiber";
import { loadPreyasBall } from "../room/loadPreyas";
import { theme } from "../theme";
import { usePageVisible } from "../ui/usePageVisible";
import { useReducedMotion } from "../ui/useReducedMotion";
import { BODY_LABEL, haloFor, motionFor, type PreyasBodyState } from "../face/bodyState.ts";
import type { PreyasClip } from "./preyasClips";

/**
 * How often a visible canvas asks for a fresh frame: 33 ms ≈ 30 fps, a hard
 * cap instead of a full 60 fps loop (slice 11).
 */
const FRAME_MS = 33;

/** One clip is a pose, not a loop: open and closed hold their last frame. */
function holdsPose(clip: PreyasClip): boolean {
  return clip === "open" || clip === "closed" || clip === "close";
}

function Scene({
  state,
  reduce,
  active,
  clip,
  small,
}: {
  state: PreyasBodyState;
  reduce: boolean;
  active: boolean;
  clip?: PreyasClip;
  /** A 46 px avatar has no room for the pedestal. */
  small?: boolean;
}) {
  const rig = useRef<Group>(null);
  const [gltf, setGltf] = useState<GLTF | null>(null);
  useEffect(() => {
    let cancel = false;
    void loadPreyasBall()
      .then((next) => {
        if (!cancel) setGltf(next);
      })
      .catch(() => {});
    return () => {
      cancel = true;
    };
  }, []);
  const scene = useMemo(() => (gltf ? gltf.scene.clone(true) : null), [gltf]);

  // The ball is rigged: idle, open, closed and happy are real clips in the GLB.
  const mixer = useRef<AnimationMixer | null>(null);
  const actions = useRef<Map<string, AnimationAction>>(new Map());
  const playing = useRef<AnimationAction | null>(null);
  useEffect(() => {
    if (!scene || !gltf) return;
    const next = new AnimationMixer(scene);
    const map = new Map<string, AnimationAction>();
    for (const clip of gltf.animations) map.set(clip.name, next.clipAction(clip));
    mixer.current = next;
    actions.current = map;
    playing.current = null;
    return () => {
      next.stopAllAction();
      next.uncacheRoot(scene);
      mixer.current = null;
      actions.current = new Map();
      playing.current = null;
    };
  }, [scene, gltf]);

  useEffect(() => {
    const map = actions.current;
    const wanted = clip ? map.get(clip) : null;
    if (playing.current === wanted) return;
    const previous = playing.current;
    if (wanted) {
      const hold = holdsPose(clip as PreyasClip);
      wanted.reset();
      wanted.setLoop(hold ? LoopOnce : LoopRepeat, hold ? 1 : Infinity);
      wanted.clampWhenFinished = hold;
      wanted.fadeIn(0.2).play();
    }
    previous?.fadeOut(0.2);
    playing.current = wanted ?? null;
  }, [clip, scene]);

  // The state drives the body: spin speed, the speaking bob and the thinking
  // wobble all come from the real signals the chat already has, never a timer.
  const motion = motionFor(state, reduce);
  const halo = haloFor(state, reduce);
  const haloRef = useRef<Mesh>(null);
  /** Seconds of visible time, so the breath is platform-neutral (no wall clock). */
  const elapsed = useRef(0);
  useFrame((_, dt) => {
    if (reduce) return;
    mixer.current?.update(dt);
    const node = rig.current;
    if (node) {
      node.rotation.y += dt * motion.spin;
      node.rotation.z = motion.wobble ? Math.sin(node.rotation.y * 2.2) * motion.wobble : 0;
      node.position.y = motion.bob ? Math.sin(node.rotation.y * 3) * motion.bob : 0;
      // Listening leans very slightly towards the person who just spoke.
      node.rotation.x = state === "listening" ? -0.06 : 0;
    }
    const ring = haloRef.current;
    if (ring) {
      elapsed.current += dt;
      const breathe =
        halo.pulseSeconds > 0 ? Math.sin((elapsed.current / halo.pulseSeconds) * Math.PI * 2) : 0;
      // Keep the state's own radius: the breath rides on top of it, it never
      // replaces it.
      ring.scale.setScalar(halo.radius * (1 + breathe * 0.035));
      const material = ring.material as { opacity?: number };
      if (material && "opacity" in material) {
        material.opacity = Math.min(1, Math.max(0, halo.strength + breathe * 0.08));
      }
    }
  });

  const { camera } = useThree();
  const invalidate = useThree((state) => state.invalidate);
  useEffect(() => {
    if (!scene) return;
    const box = new Box3().setFromObject(scene);
    const center = box.getCenter(new Vector3());
    const size = box.getSize(new Vector3());
    const dist = Math.max(size.x, size.y, size.z) * 1.35;
    camera.position.set(center.x + dist * 0.15, center.y + dist * 0.28, center.z + dist);
    camera.lookAt(center);
  }, [scene, camera]);
  useEffect(() => {
    if (!active) return;
    if (reduce) {
      // One static render: the ball is drawn once and does not spin.
      invalidate();
      return;
    }
    // The Canvas runs in "demand" mode, so this pulse is the whole loop.
    const id = setInterval(() => invalidate(), FRAME_MS);
    return () => clearInterval(id);
  }, [active, reduce, invalidate]);
  return (
    <>
      <ambientLight intensity={0.62} color="#d7f6ff" /> {/* 3d-colour */}
      <directionalLight position={[2.4, 3.6, 2.2]} intensity={1.7} color="#f7fcff" /> {/* 3d-colour */}
      <directionalLight position={[-2.2, 1.1, -1.2]} intensity={0.4} color="#43d9ad" /> {/* 3d-colour */}
      {small ? null : (
        <mesh ref={haloRef} rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.78, 0]} scale={halo.radius}>
          <ringGeometry args={[0.72, 0.98, 40]} />
          <meshBasicMaterial color={theme.accent} transparent opacity={halo.strength} />
        </mesh>
      )}
      {small ? null : (
        <mesh position={[0, -0.86, 0]}>
          <cylinderGeometry args={[0.58, 0.78, 0.12, 28]} />
          <meshStandardMaterial color="#101820" roughness={0.9} /> {/* 3d-colour */}
        </mesh>
      )}
      <group ref={rig} scale={0.26} position={[0, 0.1, 0]}>
        {scene ? (
          <primitive object={scene} />
        ) : (
          <mesh>
            <sphereGeometry args={[0.72, 28, 18]} />
            <meshStandardMaterial color="#d5dde6" metalness={0.5} roughness={0.34} emissive="#164858" emissiveIntensity={0.3} /> {/* 3d-colour */}
          </mesh>
        )}
      </group>
    </>
  );
}

/**
 * The ball on a pedestal. No room simulation: the body speaks in four states.
 *
 * `state` is what he is really doing (rest / listening / thinking / speaking),
 * decided by face/bodyState.ts from the same signals the face already uses: the
 * mic, a reply in flight, his voice. The halo changes size and brightness for
 * every state and the loop adds spin, a lean, a wobble or the speaking bob, so
 * you can read him at a glance without any invented activity.
 *
 * `size` renders a small square (the avatar in the face panel) instead of the
 * tall hero; `fill` lets the frame take whatever height its parent gives it (the
 * Profile panel). `clip` plays one of the ball's own animations.
 *
 * Slice 11: the loop is "never" while the tab is hidden, "demand" with a
 * 33 ms invalidate() pulse (~30 fps cap) while visible, and reduced motion
 * gets a single static render: the halo still changes size and brightness, so
 * the state survives as information instead of movement.
 */
export function PreyasHero({
  state,
  short = false,
  size,
  clip,
  fill,
}: {
  state: PreyasBodyState;
  short?: boolean;
  size?: number;
  clip?: PreyasClip;
  fill?: boolean;
}) {
  const visible = usePageVisible();
  const reduce = useReducedMotion();
  const frameloop = visible && !reduce ? "demand" : "never";
  const box = size ? { width: size, height: size } : undefined;
  return (
    <View
      style={[styles.frame, box, size ? undefined : fill ? styles.fill : short ? styles.short : styles.tall]}
      accessibilityRole="image"
      accessibilityLabel={BODY_LABEL[state]}
    >
      <Canvas camera={{ position: [0.15, 1.7, 3.6], fov: 32 }} dpr={[1, 1.25]} frameloop={frameloop}>
        <Scene state={state} reduce={reduce} active={visible} clip={clip} small={Boolean(size && size < 90)} />
      </Canvas>
    </View>
  );
}

const SHORT = theme.space.xl * 5;
const TALL = theme.space.xl * 8;
const HERO_MIN = theme.space.xl * 7;

const styles = StyleSheet.create({
  frame: { width: "100%", borderRadius: theme.radius.md, overflow: "hidden", backgroundColor: "transparent" },
  fill: { flex: 1, minHeight: HERO_MIN },
  short: { height: SHORT },
  tall: { height: TALL },
});
