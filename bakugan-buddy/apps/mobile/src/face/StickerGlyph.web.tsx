/**
 * Web playback for a bundled Noto Lottie file.
 * A plain div is the container: lottie-web appends an SVG and moves it.
 * The ref callback is stable so a chat re-render does not restart the clip
 * on its first frame.
 */
import { useCallback, useEffect, useRef } from "react";
import lottie, { type AnimationItem } from "lottie-web";
import { STICKER_LOTTIE } from "./stickerSources.ts";

function animationData(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object") return null;
  const record = value as { layers?: unknown; default?: { layers?: unknown } };
  if (Array.isArray(record.layers)) return record as Record<string, unknown>;
  if (record.default && Array.isArray(record.default.layers)) return record.default as Record<string, unknown>;
  return null;
}

export function StickerGlyph({ code, emoji, size }: { code: string; emoji: string; size: number }) {
  const data = animationData(STICKER_LOTTIE[code]);
  const anim = useRef<AnimationItem | null>(null);
  const nodeRef = useRef<HTMLDivElement | null>(null);
  const dataRef = useRef(data);
  dataRef.current = data;

  useEffect(() => () => anim.current?.destroy(), []);

  // The callback stays the same object so a parent re-render does not
  // detach the div and restart the clip on its first frame.
  const attach = useCallback((node: HTMLDivElement | null) => {
    if (node === nodeRef.current) return;
    nodeRef.current = node;
    anim.current?.destroy();
    anim.current = null;
    const payload = dataRef.current;
    if (!node || !payload) return;
    const item = lottie.loadAnimation({
      container: node,
      renderer: "svg",
      loop: true,
      autoplay: true,
      animationData: payload,
    });
    item.play();
    anim.current = item;
  }, []);

  if (!data) return <span aria-label={emoji}>{emoji}</span>;

  return (
    <div
      aria-label={emoji}
      ref={attach}
      style={{ width: size, height: size, overflow: "hidden", lineHeight: 0 }}
    />
  );
}
