import { useEffect, useMemo, useRef, useState } from "react";
import { StyleSheet, View } from "react-native";
import { Box3, Vector3, type Group } from "three";
import type { GLTF } from "three/addons/loaders/GLTFLoader.js";
import { Canvas, useFrame, useThree } from "../room/fiber";
import { loadPreyasBall } from "../room/loadPreyas";
import { theme } from "../theme";

function Scene({ talking }: { talking: boolean }) {
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
  useFrame((_, dt) => {
    const node = rig.current;
    if (!node) return;
    node.rotation.y += dt * (talking ? 0.85 : 0.28);
    node.position.y = talking ? Math.sin(node.rotation.y * 3) * 0.05 : 0;
  });
  const { camera } = useThree();
  useEffect(() => {
    if (!scene) return;
    const box = new Box3().setFromObject(scene);
    const center = box.getCenter(new Vector3());
    const size = box.getSize(new Vector3());
    const dist = Math.max(size.x, size.y, size.z) * 1.35;
    camera.position.set(center.x + dist * 0.15, center.y + dist * 0.28, center.z + dist);
    camera.lookAt(center);
  }, [camera, scene]);
  return (
    <>
      <color attach="background" args={["#071410"]} />
      <ambientLight intensity={0.62} color="#d7f6ff" />
      <directionalLight position={[2.4, 3.6, 2.2]} intensity={1.7} color="#f7fcff" />
      <directionalLight position={[-2.2, 1.1, -1.2]} intensity={0.4} color="#43d9ad" />
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.78, 0]}>
        <ringGeometry args={[0.72, 0.98, 40]} />
        <meshBasicMaterial color="#43d9ad" transparent opacity={0.5} />
      </mesh>
      <mesh position={[0, -0.86, 0]}>
        <cylinderGeometry args={[0.58, 0.78, 0.12, 28]} />
        <meshStandardMaterial color="#101820" roughness={0.9} />
      </mesh>
      <group ref={rig} scale={0.26} position={[0, 0.1, 0]}>
        {scene ? (
          <primitive object={scene} />
        ) : (
          <mesh>
            <sphereGeometry args={[0.72, 28, 18]} />
            <meshStandardMaterial color="#d5dde6" metalness={0.5} roughness={0.34} emissive="#164858" emissiveIntensity={0.3} />
          </mesh>
        )}
      </group>
    </>
  );
}

/**
 * The ball on a pedestal. One slow spin, no room simulation.
 * `fill` lets the frame take whatever height its parent gives it (the Profile panel).
 */
export function PreyasHero({ talking, short, fill }: { talking: boolean; short: boolean; fill?: boolean }) {
  return (
    <View style={[styles.frame, fill ? styles.fill : short ? styles.short : styles.tall]}>
      <Canvas camera={{ position: [0.15, 1.7, 3.6], fov: 32 }} dpr={[1, 1.25]}>
        <Scene talking={talking} />
      </Canvas>
    </View>
  );
}

const SHORT = theme.space.xl * 5;
const TALL = theme.space.xl * 8;
const HERO_MIN = theme.space.xl * 7;

const styles = StyleSheet.create({
  frame: { width: "100%", borderRadius: theme.radius.md, overflow: "hidden", backgroundColor: "#071410" },
  fill: { flex: 1, minHeight: HERO_MIN },
  short: { height: SHORT },
  tall: { height: TALL },
});
