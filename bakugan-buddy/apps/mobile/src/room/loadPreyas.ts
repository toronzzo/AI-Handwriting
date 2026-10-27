import { Asset } from "expo-asset";
import { File } from "expo-file-system";
import { GLTFLoader, type GLTF } from "three/addons/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";

const model = require("../../assets/models/preyas_ball.glb");

let pending: Promise<GLTF> | null = null;

async function readBytes(uri: string): Promise<ArrayBuffer> {
  if (uri.startsWith("file:") || uri.startsWith("content:")) {
    return new File(uri).arrayBuffer();
  }
  const response = await fetch(uri);
  if (!response.ok) throw new Error(`preyas glb ${response.status}`);
  return response.arrayBuffer();
}

/** One meshopt GLB, decoded once. The frame loop never touches this. */
export function loadPreyasBall(): Promise<GLTF> {
  if (pending) return pending;
  pending = (async () => {
    const asset = Asset.fromModule(model);
    if (!asset.localUri && !asset.downloaded) await asset.downloadAsync();
    const uri = asset.localUri || asset.uri;
    await MeshoptDecoder.ready;
    const loader = new GLTFLoader();
    loader.setMeshoptDecoder(MeshoptDecoder);
    const bytes = await readBytes(uri);
    return loader.parseAsync(bytes, "");
  })();
  pending.catch((error: unknown) => {
    pending = null;
    const message = error instanceof Error ? error.message : String(error);
    console.error(`preyas glb failed: ${message}`);
  });
  return pending;
}
