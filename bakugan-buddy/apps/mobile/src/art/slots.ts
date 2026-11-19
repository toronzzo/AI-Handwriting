/**
 * The user's own pictures (slice 10).
 *
 * A fixed whitelist of slots, each one file named <slot>.jpg|jpeg|png|webp in
 * /Volumes/Agent/agent/art (then /Volumes/Agent/agent/prototypes/images). The
 * brain reads the file; the app only asks for the bytes.
 *
 * An <img src="…"> cannot carry the pairing header, so the picture is fetched
 * with the same authed helper as every other brain call (brainFetch, which
 * attaches X-Preyas-Token), turned into a blob object URL and that is what the
 * Image shows. The URL is revoked when the slot unmounts, when its picture
 * changes, or when the tab is hidden for good. A 404 simply means "no image".
 *
 * Slice 10b lets the user change a picture from inside the app: `uploadArt`
 * sends the picked bytes to the brain, which saves them and moves the old
 * picture to art/old/. The brain decides the type from the bytes; the name
 * and Content-Type here are just what the file happens to claim.
 */
import { useCallback, useEffect, useState } from "react";
import { currentBrainUrl } from "../room/brain/brainLink.ts";
import { brainFetch } from "../room/brain/token.ts";

/** The seven fixed slots. Anything else is refused by the brain as a bad slot. */
export const SLOT_IDS = ["hero", "bg", "house", "car", "study", "bakugan-buddy", "studio"] as const;

export type SlotId = (typeof SLOT_IDS)[number];

/** One slot's picture: the object URL to show, or why there is none. */
export type ArtState = {
  /** Blob object URL, or "" when there is no picture to show. */
  url: string;
  /** "loading" until the first answer, then "ready" or "none". */
  status: "loading" | "ready" | "none";
};

export function isSlotId(value: string): value is SlotId {
  return (SLOT_IDS as readonly string[]).includes(value);
}

/** The brain route for one slot. */
export function artUrl(slot: SlotId, brain = currentBrainUrl()): string {
  return `${brain.replace(/\/$/, "")}/v1/art/${slot}`;
}

/** How often a visible tab asks again for a picture that is not there yet. */
export const ART_RECHECK_MS = 60_000;

/** One slot's picture plus a way to ask for it again after a new one is saved. */
export type ArtHookState = ArtState & {
  /** Look again now, for example right after the user saved a new picture. */
  reload: () => void;
};

/** The brain refuses pictures over 8 MB; checked here first for a clear message. */
export const MAX_ART_UPLOAD_BYTES = 8 * 1024 * 1024;

/**
 * Send one picked picture to the brain, which saves it in the art folder.
 *
 * `uri` is what the image picker returned: a file:// or content:// path on the
 * phone, or a blob: URL in the browser. Only images the brain can read (jpeg,
 * png, webp) are accepted; anything else comes back as an error.
 *
 * @returns the saved picture's type and size.
 * @throws {Error} when the picture could not be read or the brain said no;
 *   the message is short and safe to show.
 */
export async function uploadArt(
  slot: SlotId,
  uri: string,
  brain = currentBrainUrl(),
): Promise<{ type: string; size: number }> {
  if (!isSlotId(slot)) throw new Error("Unknown picture slot");
  const bytes = await readArtBytes(uri);
  if (!bytes.size) throw new Error("That picture is empty");
  if (bytes.size > MAX_ART_UPLOAD_BYTES) throw new Error("That picture is over 8 MB");
  const res = await brainFetch(artUrl(slot, brain), {
    method: "POST",
    headers: { "Content-Type": "application/octet-stream" },
    body: bytes,
  });
  const body = (await res.json().catch(() => ({}))) as { ok?: boolean; type?: string; size?: number; error?: string };
  if (!res.ok || !body.ok) {
    throw new Error(body.error === "bad slot" ? "Unknown picture slot" : "The Mac did not take the picture");
  }
  return { type: body.type || "", size: body.size || bytes.size };
}

/**
 * Read a picked image into a Blob. The browser and the phone keep a picked
 * file in different places, so both are tried: fetch() handles blob: and
 * http: URLs in the browser, expo-file-system a file:// path on the phone.
 */
async function readArtBytes(uri: string): Promise<Blob> {
  try {
    const res = await fetch(uri);
    if (res.ok) {
      const blob = await res.blob();
      if (blob.size) return blob;
    }
  } catch {
    /* not a URL this platform can fetch: try the file system next */
  }
  try {
    const { File } = await import("expo-file-system");
    // A File is a Blob with no type: the brain judges the bytes anyway.
    return new File(uri);
  } catch {
    throw new Error("That picture could not be read");
  }
}

/**
 * Fetch one slot's picture and keep it available as a blob URL.
 *
 * `show` lets a caller that only needs the picture under a condition (the
 * level card's hero) skip the download until it matters. A hidden tab is not
 * asked; when it becomes visible again the picture is checked again, at most
 * once per minute. `version` lets a caller force a fresh look (for example
 * after the user dropped a new file in), and so does the returned `reload()`.
 */
export function useArt(slot: SlotId, options: { show?: boolean; version?: number } = {}): ArtHookState {
  const show = options.show !== false;
  const version = options.version ?? 0;
  const [state, setState] = useState<ArtState>({ url: "", status: "loading" });
  // A caller that saved a new picture bumps this to look again straight away;
  // the version option keeps working for callers that pass their own.
  const [reloadCount, setReloadCount] = useState(0);

  useEffect(() => {
    if (!show) {
      setState({ url: "", status: "none" });
      return;
    }

    let cancelled = false;
    let current: string | null = null;
    let lastCheck = 0;

    const release = () => {
      if (current && typeof URL !== "undefined" && typeof URL.revokeObjectURL === "function") {
        URL.revokeObjectURL(current);
      }
      current = null;
    };

    const check = () => {
      const now = Date.now();
      lastCheck = now;
      void (async () => {
        try {
          const res = await brainFetch(artUrl(slot));
          if (cancelled) return;
          if (!res.ok) {
            // 404 (mostly) means the user has not put this picture in yet.
            release();
            setState({ url: "", status: "none" });
            return;
          }
          const blob = await res.blob();
          if (cancelled) return;
          if (typeof URL === "undefined" || typeof URL.createObjectURL !== "function") {
            setState({ url: "", status: "none" });
            return;
          }
          const next = URL.createObjectURL(blob);
          release();
          current = next;
          setState({ url: next, status: "ready" });
        } catch {
          if (cancelled) return;
          // The Mac did not answer: keep whatever we already have.
          setState((prev) => (prev.url ? prev : { url: "", status: "none" }));
        }
      })();
    };

    check();

    const onVisible = () => {
      if (typeof document !== "undefined" && document.hidden) return;
      if (Date.now() - lastCheck < ART_RECHECK_MS) return;
      check();
    };
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", onVisible);
    }

    return () => {
      cancelled = true;
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", onVisible);
      }
      release();
    };
  }, [slot, show, version, reloadCount]);

  const reload = useCallback(() => setReloadCount((n) => n + 1), []);

  return { url: state.url, status: state.status, reload };
}
