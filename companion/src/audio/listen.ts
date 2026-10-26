import { playListenTick } from "./emotionSounds";

type ListenHandlers = {
  onPartial?: (text: string) => void;
  onFinal?: (text: string) => void;
  onListeningChange?: (listening: boolean) => void;
  onReact?: () => void;
};

type Rec = SpeechRecognition;

declare global {
  interface Window {
    SpeechRecognition?: { new (): Rec };
    webkitSpeechRecognition?: { new (): Rec };
  }
}

export function speechRecognitionAvailable(): boolean {
  return Boolean(window.SpeechRecognition || window.webkitSpeechRecognition);
}

/**
 * Continuous listen with micro-reactions while the user is still talking.
 */
export function createListener(handlers: ListenHandlers) {
  const Ctor = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!Ctor) {
    return {
      supported: false as const,
      start() {},
      stop() {},
    };
  }

  const rec = new Ctor();
  rec.continuous = true;
  rec.interimResults = true;
  rec.lang = "en-US";

  let active = false;
  let lastReact = 0;

  rec.onstart = () => handlers.onListeningChange?.(true);
  rec.onend = () => {
    handlers.onListeningChange?.(false);
    // Chrome drops continuous mode — restart if still wanted
    if (active) {
      try {
        rec.start();
      } catch {
        /* already started */
      }
    }
  };
  rec.onerror = () => handlers.onListeningChange?.(false);

  rec.onresult = (ev: SpeechRecognitionEvent) => {
    let interim = "";
    let finalText = "";
    for (let i = ev.resultIndex; i < ev.results.length; i++) {
      const r = ev.results[i]!;
      if (r.isFinal) finalText += r[0]!.transcript;
      else interim += r[0]!.transcript;
    }
    if (interim) {
      handlers.onPartial?.(interim);
      const now = performance.now();
      if (now - lastReact > 700) {
        lastReact = now;
        playListenTick();
        handlers.onReact?.();
      }
    }
    if (finalText.trim()) handlers.onFinal?.(finalText.trim());
  };

  return {
    supported: true as const,
    start() {
      active = true;
      try {
        rec.start();
      } catch {
        /* ignore */
      }
    },
    stop() {
      active = false;
      try {
        rec.stop();
      } catch {
        /* ignore */
      }
      handlers.onListeningChange?.(false);
    },
  };
}
