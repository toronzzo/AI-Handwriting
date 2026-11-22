/**
 * Offline pictures and articles are served by the brain, which requires the
 * pairing token (or the Mac page's Origin). An <img> tag sends neither, so the
 * browser gets 401 JSON and draws a grey box. Fetch with the same helper every
 * other brain call uses, then hand the bytes to the image as a local URL.
 */
import { brainFetch } from "../room/brain/token.ts";

export type LoadedMedia = { url: string; revoke: () => void };

function bytesToDataUrl(bytes: Uint8Array, type: string): string {
  let binary = "";
  const step = 0x8000;
  for (let index = 0; index < bytes.length; index += step) {
    binary += String.fromCharCode(...bytes.subarray(index, index + step));
  }
  return `data:${type};base64,${btoa(binary)}`;
}

/**
 * Load one brain URL that an <img> or a new tab cannot authenticate itself.
 * Prefers a blob URL. Falls back to a data URL where the platform has no
 * object URLs (a native image still needs a uri string).
 */
export async function loadAuthedMediaUrl(
  url: string,
  fetchImpl: typeof fetch = brainFetch,
): Promise<LoadedMedia | null> {
  const target = String(url || "");
  if (!target) return null;
  try {
    const res = await fetchImpl(target);
    if (!res.ok) return null;
    const blob = await res.blob();
    const type = blob.type || "application/octet-stream";
    if (typeof URL !== "undefined" && typeof URL.createObjectURL === "function") {
      const objectUrl = URL.createObjectURL(blob);
      return {
        url: objectUrl,
        revoke: () => {
          if (typeof URL.revokeObjectURL === "function") URL.revokeObjectURL(objectUrl);
        },
      };
    }
    const bytes = new Uint8Array(await blob.arrayBuffer());
    return { url: bytesToDataUrl(bytes, type), revoke: () => {} };
  } catch {
    return null;
  }
}

/** Open an offline article with the pairing header, then show the bytes. */
export async function openAuthedPage(url: string, fetchImpl: typeof fetch = brainFetch): Promise<boolean> {
  const target = String(url || "");
  if (!target || typeof window === "undefined" || typeof window.open !== "function") return false;
  if (!/\/v1\/offline\/(?:article|image)\?/.test(target)) {
    window.open(target, "_blank", "noopener");
    return true;
  }
  const loaded = await loadAuthedMediaUrl(target, fetchImpl);
  if (!loaded) return false;
  window.open(loaded.url, "_blank", "noopener");
  setTimeout(loaded.revoke, 60_000);
  return true;
}
