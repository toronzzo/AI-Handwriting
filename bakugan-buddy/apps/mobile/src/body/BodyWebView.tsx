import { createElement, useCallback, useRef } from "react";
import { StyleSheet, View } from "react-native";
import { WebView } from "react-native-webview";
import { BODY_HTML } from "../bodyHtml.generated";

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

type WVRef = {
  injectJavaScript: (js: string) => void;
};

/**
 * M1 body host: same runtime as body.html.
 * Bridge: setEmotion / setTheme / setTalking / react
 */
export function BodyWebView({ onMetrics }: Props) {
  const ref = useRef<WVRef | null>(null);

  const inject = useCallback((js: string) => {
    ref.current?.injectJavaScript(`${js}; true;`);
  }, []);

  const onMessage = useCallback(
    (e: { nativeEvent: { data: string } }) => {
      try {
        const data = JSON.parse(e.nativeEvent.data) as BodyMetrics;
        onMetrics?.(data);
      } catch {
        /* ignore */
      }
    },
    [onMetrics],
  );

  BodyWebViewAPI.inject = inject;

  const bridge = `
    (function(){
      if (!window.BakuganBody) return;
      setInterval(function(){
        var m = window.BakuganBody.getMetrics();
        var s = window.BakuganBody.getState();
        window.ReactNativeWebView && window.ReactNativeWebView.postMessage(JSON.stringify({
          fps: m.fps,
          droppedApprox: m.droppedApprox || m.dropped || 0,
          emotion: s.emotion,
          reactionMs: m.reactionMs,
          at: Date.now()
        }));
      }, 500);
    })();
    true;
  `;

  // createElement avoids broken WebView prop types on RN-web stubs
  const webview = createElement(WebView as unknown as React.ComponentType<Record<string, unknown>>, {
    ref,
    originWhitelist: ["*"],
    source: { html: BODY_HTML },
    style: styles.web,
    onMessage,
    onLoadEnd: () => inject(bridge),
    allowFileAccess: true,
    javaScriptEnabled: true,
    domStorageEnabled: true,
    mediaPlaybackRequiresUserAction: false,
  });

  return <View style={styles.wrap}>{webview}</View>;
}

export const BodyWebViewAPI = {
  inject: (_js: string) => {},
  setEmotion(mood: string) {
    BodyWebViewAPI.inject(
      `window.BakuganBody && window.BakuganBody.setEmotion(${JSON.stringify(mood)})`,
    );
  },
  setTheme(theme: string) {
    BodyWebViewAPI.inject(
      `window.BakuganBody && window.BakuganBody.setTheme(${JSON.stringify(theme)})`,
    );
  },
  setTalking(v: boolean | number) {
    BodyWebViewAPI.inject(
      `window.BakuganBody && window.BakuganBody.setTalking(${JSON.stringify(v)})`,
    );
  },
  react(tagged: string) {
    BodyWebViewAPI.inject(
      `window.BakuganBody && window.BakuganBody.react(${JSON.stringify(tagged)})`,
    );
  },
};

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: "#050505" },
  web: { flex: 1, backgroundColor: "transparent" },
});
