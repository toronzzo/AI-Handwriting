import { useEffect, useState } from "react";
import { peekActivity, subscribeActivity } from "./activityStore.ts";
import type { PreyasBodyState } from "../face/bodyState.ts";
import { usePageVisible } from "../ui/usePageVisible";

/**
 * The body state any screen can read: what Preyas is really doing right now,
 * published by the chat screen. While the tab is hidden the value is still
 * correct (the chat may be working in the background), it simply is not worth
 * a second subscription: the hook keeps the last known state and re-reads on
 * the way back.
 */
export function usePreyasActivity(): PreyasBodyState {
  const visible = usePageVisible();
  const [state, setState] = useState<PreyasBodyState>(() => peekActivity());
  useEffect(() => {
    if (!visible) return;
    setState(peekActivity());
    return subscribeActivity(setState);
  }, [visible]);
  return state;
}
