import { playListenTick } from "./emotionSounds";
import { pingStudio, studioSttWsUrl, lastStudioHealth } from "../studio";

type ListenHandlers = {
  onPartial?: (text: string) => void;
  onFinal?: (text: string) => void;
  onListeningChange?: (listening: boolean) => void;
  onReact?: () => void;
};

export function speechRecognitionAvailable(): boolean {
  return Boolean(lastStudioHealth()?.stt?.ready);
}

function downsampleTo16k(input: Float32Array, fromRate: number): Int16Array {
  const to = 16000;
  if (fromRate === to) {
    const out = new Int16Array(input.length);
    for (let i = 0; i < input.length; i++) {
      const s = Math.max(-1, Math.min(1, input[i]!));
      out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }
    return out;
  }
  const ratio = fromRate / to;
  const n = Math.floor(input.length / ratio);
  const out = new Int16Array(n);
  for (let i = 0; i < n; i++) {
    const s = Math.max(-1, Math.min(1, input[Math.floor(i * ratio)]!));
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return out;
}

/**
 * Offline listen: mic PCM → studio sherpa-onnx WebSocket.
 */
export function createListener(handlers: ListenHandlers) {
  let active = false;
  let ws: WebSocket | null = null;
  let ctx: AudioContext | null = null;
  let node: AudioWorkletNode | null = null;
  let source: MediaStreamAudioSourceNode | null = null;
  let stream: MediaStream | null = null;
  let lastReact = 0;

  async function start() {
    const health = await pingStudio();
    if (!health?.stt?.ready) {
      handlers.onListeningChange?.(false);
      return;
    }
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 },
    });
    ctx = new AudioContext();
    await ctx.audioWorklet.addModule("/pcm-worklet.js");
    source = ctx.createMediaStreamSource(stream);
    node = new AudioWorkletNode(ctx, "pcm-capture");
    source.connect(node);
    const mute = ctx.createGain();
    mute.gain.value = 0;
    node.connect(mute);
    mute.connect(ctx.destination);

    const rate = ctx.sampleRate;
    ws = new WebSocket(studioSttWsUrl());
    ws.binaryType = "arraybuffer";
    ws.onopen = () => {
      active = true;
      handlers.onListeningChange?.(true);
    };
    ws.onerror = () => handlers.onListeningChange?.(false);
    ws.onclose = () => {
      if (active) handlers.onListeningChange?.(false);
    };
    ws.onmessage = (ev) => {
      let msg: { type: string; text?: string };
      try {
        msg = JSON.parse(String(ev.data));
      } catch {
        return;
      }
      if (msg.type === "partial" && msg.text) {
        handlers.onPartial?.(msg.text);
        const now = performance.now();
        if (now - lastReact > 700) {
          lastReact = now;
          playListenTick();
          handlers.onReact?.();
        }
      }
      if (msg.type === "final" && msg.text?.trim()) {
        handlers.onFinal?.(msg.text.trim());
      }
    };

    node.port.onmessage = (ev) => {
      if (!active || ws?.readyState !== WebSocket.OPEN) return;
      const pcm = downsampleTo16k(ev.data as Float32Array, rate);
      const copy = Int16Array.from(pcm);
      ws.send(copy.buffer as ArrayBuffer);
    };
  }

  function stop() {
    active = false;
    try {
      ws?.send(JSON.stringify({ type: "end" }));
      ws?.close();
    } catch {
      /* ignore */
    }
    ws = null;
    node?.disconnect();
    source?.disconnect();
    stream?.getTracks().forEach((t) => t.stop());
    void ctx?.close();
    node = null;
    source = null;
    stream = null;
    ctx = null;
    handlers.onListeningChange?.(false);
  }

  return {
    supported: true as const,
    start() {
      void start();
    },
    stop,
  };
}
