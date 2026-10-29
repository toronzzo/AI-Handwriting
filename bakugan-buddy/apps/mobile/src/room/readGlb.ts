import { Asset } from "expo-asset";
import { File } from "expo-file-system";

export async function readGlb(moduleId: number): Promise<ArrayBuffer> {
  const asset = Asset.fromModule(moduleId);
  if (!asset.localUri && !asset.downloaded) await asset.downloadAsync();
  const uri = asset.localUri || asset.uri;
  if (uri.startsWith("file:") || uri.startsWith("content:")) {
    return new File(uri).arrayBuffer();
  }
  const response = await fetch(uri);
  if (!response.ok) throw new Error(`preyas glb ${response.status}`);
  return response.arrayBuffer();
}
