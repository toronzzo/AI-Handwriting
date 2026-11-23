/**
 * Web host for the same body.html runtime.
 * The stock web view only renders a red "not supported" line, so
 * Settings → Body was an error on the browser. An iframe
 * with the generated document runs the canvas, and the parent calls
 * window.BakuganBody directly (srcdoc is same-origin).
 */
import { createElement, useEffect, useRef } from "react";
import { StyleSheet, View } from "react-native";
import { BODY_HTML } from "../bodyHtml.generated";
import { theme } from "../theme";

export type BodyMetrics = {
  fps: number;
  droppedApprox: number;
  emotion: string;
  reactionMs: number | null;
  at: number;
};

type Props = {
  onMetrics?: (m: BodyMetrics) => void;
};

type BodyApi = {
  setEmotion: (mood: string) => void;
  setTheme: (theme: string) => void;
  setTalking: (v: boolean | number) => void;
  react: (tagged: string) => void;
  getState: () => { emotion: string };
  getMetrics: () => { fps: number; droppedApprox?: number; dropped?: number; reactionMs: number | null };
};

let frame: HTMLIFrameElement | null = null;

function bodyApi(): BodyApi | null {
  try {
    const win = frame?.contentWindow as (Window & { BakuganBody?: BodyApi }) | null;
    return win?.BakuganBody ?? null;
  } catch {
    return null;
  }
}

export function BodyWebView({ onMetrics }: Props) {
  const onMetricsRef = useRef(onMetrics);
  onMetricsRef.current = onMetrics;

  useEffect(() => {
    const id = setInterval(() => {
      const api = bodyApi();
      if (!api) return;
      const metrics = api.getMetrics();
      const state = api.getState();
      onMetricsRef.current?.({
        fps: metrics.fps,
        droppedApprox: metrics.droppedApprox || metrics.dropped || 0,
        emotion: state.emotion,
        reactionMs: metrics.reactionMs,
        at: Date.now(),
      });
    }, 500);
    return () => clearInterval(id);
  }, []);

  return (
    <View style={styles.wrap}>
      {createElement("iframe", {
        title: "Preyas body",
        srcDoc: BODY_HTML,
        ref: (node: HTMLIFrameElement | null) => {
          frame = node;
        },
        style: {
          position: "absolute",
          inset: 0,
          border: 0,
          width: "100%",
          height: "100%",
          background: "transparent",
        },
      })}
    </View>
  );
}

export const BodyWebViewAPI = {
  inject: (_js: string) => {},
  setEmotion(mood: string) {
    bodyApi()?.setEmotion(mood);
  },
  setTheme(next: string) {
    bodyApi()?.setTheme(next);
  },
  setTalking(v: boolean | number) {
    bodyApi()?.setTalking(v);
  },
  react(tagged: string) {
    bodyApi()?.react(tagged);
  },
};

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: theme.bg, position: "relative" },
});
