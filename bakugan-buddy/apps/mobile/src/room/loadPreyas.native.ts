import { GLTFLoader, type GLTF } from "three/addons/loaders/GLTFLoader.js";
import { readGlb } from "./readGlb";

const model = require("../../assets/models/preyas_ball.native.glb");

let pending: Promise<GLTF> | null = null;

/**
 * iOS and Android. Hermes has no WebAssembly, so this file is the same
 * ball with KHR_mesh_quantization only — no MeshoptDecoder.
 */
export function loadPreyasBall(): Promise<GLTF> {
  if (pending) return pending;
  pending = (async () => {
    const loader = new GLTFLoader();
    const bytes = await readGlb(model);
    return loader.parseAsync(bytes, "");
  })();
  pending.catch((error: unknown) => {
    pending = null;
    const message = error instanceof Error ? error.message : String(error);
    console.error(`preyas glb failed: ${message}`);
  });
  return pending;
}
