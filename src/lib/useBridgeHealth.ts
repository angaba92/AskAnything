"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { bridgeHealth, bridgeHealthSummary, INITIAL_BRIDGE_HEALTH } from "./bridgeHealth";
import { watchExtensionBridge } from "./extensionBridge";

export function useBridgeHealth() {
  const state = useSyncExternalStore(
    bridgeHealth.subscribe, bridgeHealth.getSnapshot, () => INITIAL_BRIDGE_HEALTH,
  );
  const [now, setNow] = useState(0);
  useEffect(watchExtensionBridge, []);
  useEffect(() => {
    const tick = () => setNow(Date.now());
    const network = () => { bridgeHealth.network(navigator.onLine); tick(); };
    network();
    const timer = window.setInterval(tick, 1000);
    window.addEventListener("online", network);
    window.addEventListener("offline", network);
    window.addEventListener("focus", tick);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("online", network);
      window.removeEventListener("offline", network);
      window.removeEventListener("focus", tick);
    };
  }, []);
  return { state, now, summary: bridgeHealthSummary(state, now) };
}
