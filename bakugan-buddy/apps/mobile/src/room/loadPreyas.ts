import { GLTFLoader, type GLTF } from "three/addons/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import { readGlb } from "./readGlb";

const model = require("../../assets/models/preyas_ball.glb");

let pending: Promise<GLTF> | null = null;

/** Web build. Meshopt needs WASM, which the browser has. */
export function loadPreyasBall(): Promise<GLTF> {
  if (pending) return pending;
  pending = (async () => {
    await MeshoptDecoder.ready;
    const loader = new GLTFLoader();
    loader.setMeshoptDecoder(MeshoptDecoder);
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
