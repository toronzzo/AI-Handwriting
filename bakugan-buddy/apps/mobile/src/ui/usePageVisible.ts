import { useEffect, useState } from "react";
import { AppState } from "react-native";

/**
 * True while the page is actually on screen: document.visibilityState is
 * "visible" on the web, AppState is "active" on the iPhone. Timers that only
 * paint (the clock, the focus ring, the palette re-check, the 3D ball) use
 * this to stop ticking while nobody is looking and catch up on return.
 */
export function usePageVisible(): boolean {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    if (typeof document !== "undefined") {
      const update = () => setVisible(document.visibilityState === "visible");
      update();
      document.addEventListener("visibilitychange", update);
      return () => document.removeEventListener("visibilitychange", update);
    }
    const subscription = AppState.addEventListener("change", (state) =>
      setVisible(state === "active"),
    );
    return () => subscription.remove();
  }, []);

  return visible;
}
