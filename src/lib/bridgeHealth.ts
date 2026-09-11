export interface BridgeIdentity {
  extensionId?: string;
  extensionVersion?: string;
  transport?: string;
}

export type BridgeStage = "extension" | "ka" | "app" | "answer";
export interface BridgeHealth {
  extension: "unknown" | "detected" | "missing";
  identity: BridgeIdentity | null;
  extensionCheckedAt: number | null;
  phase: "untested" | "discovering" | "requesting" | "processing" | "ready" | "error" | "cancelled";
  startedAt: number | null;
  kaRespondedAt: number | null;
  lastSuccessAt: number | null;
  lastDurationMs: number | null;
  error: string | null;
  errorStage: BridgeStage | null;
  online: boolean | null;
}

export const INITIAL_BRIDGE_HEALTH: BridgeHealth = {
  extension: "unknown", identity: null, extensionCheckedAt: null,
  phase: "untested", startedAt: null, kaRespondedAt: null,
  lastSuccessAt: null, lastDurationMs: null, error: null, errorStage: null,
  online: null,
};
export const BRIDGE_CONFIRMATION_TTL_MS = 60000;

export function createBridgeHealthStore(now = Date.now) {
  let state = INITIAL_BRIDGE_HEALTH;
  let request = 0;
  let probe = 0;
  const listeners = new Set<() => void>();
  const update = (patch: Partial<BridgeHealth>) => {
    state = { ...state, ...patch };
    for (const listener of listeners) listener();
  };
  return {
    getSnapshot: () => state,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    beginProbe: () => ({ probe: ++probe, request }),
    completeProbe(ticket: { probe: number; request: number }, identity: BridgeIdentity | null, error?: string) {
      if (ticket.probe !== probe || ticket.request !== request) return;
      const changed = identity && state.identity && (
        identity.extensionId !== state.identity.extensionId ||
        identity.extensionVersion !== state.identity.extensionVersion ||
        identity.transport !== state.identity.transport
      );
      update(identity
        ? { extension: "detected", identity, extensionCheckedAt: now(), ...(changed && state.phase === "ready" ? { phase: "untested" as const } : {}) }
        : { extension: "missing", extensionCheckedAt: now(), phase: "error", errorStage: "extension", error: error || "The extension did not respond." });
    },
    beginRequest() {
      ++probe;
      ++request;
      update({ phase: "discovering", startedAt: now(), kaRespondedAt: null, error: null, errorStage: null });
      return request;
    },
    selected(ticket: number, identity: BridgeIdentity) {
      if (ticket !== request) return;
      update({ extension: "detected", identity, extensionCheckedAt: now(), phase: "requesting" });
    },
    kaResponded(ticket: number) {
      if (ticket !== request || state.phase === "cancelled") return;
      update({ phase: "processing", kaRespondedAt: now() });
    },
    succeed(ticket: number) {
      if (ticket !== request || state.phase !== "processing") return;
      update({ phase: "ready", error: null, errorStage: null, lastSuccessAt: now(), lastDurationMs: now() - (state.startedAt ?? now()) });
    },
    fail(ticket: number, stage: BridgeStage, error: string) {
      if (ticket !== request) return;
      update({ phase: "error", error, errorStage: stage,
        ...(stage === "extension" ? { extension: "missing" as const, extensionCheckedAt: now() } : {}) });
    },
    cancel(ticket: number, reason?: unknown) {
      if (ticket !== request) return;
      if (reason && typeof reason === "object" && "name" in reason && reason.name === "TimeoutError") {
        update({ phase: "error", errorStage: state.kaRespondedAt === null ? "ka" : "app",
          error: "message" in reason ? String(reason.message) : "Request timed out." });
        return;
      }
      update({ phase: "cancelled", error: null, errorStage: null });
    },
    network(online: boolean) {
      update(online ? { online } : {
        online, phase: "error", errorStage: "extension", error: "The browser is offline.",
      });
    },
  };
}

export const bridgeHealth = createBridgeHealthStore();

export function bridgeHealthSummary(state: BridgeHealth, now: number): { label: string; tone: "success" | "warning" | "error" | "info" } {
  if (state.online === false) return { label: "Browser offline", tone: "error" };
  if (state.phase === "error") return {
    label: state.errorStage === "answer" ? "Answer needs attention" : `${state.errorStage === "app" ? "App" : "Bridge"} request failed`,
    tone: "error",
  };
  if (state.phase === "discovering") return { label: "Checking extension", tone: "info" };
  if (state.phase === "requesting") return { label: "Waiting for KA", tone: "info" };
  if (state.phase === "processing") return { label: "KA replied; checking app", tone: "info" };
  if (state.phase === "cancelled") return { label: "Request cancelled; unverified", tone: "warning" };
  if (state.extension === "missing") return { label: "Extension not detected", tone: "error" };
  if (state.phase === "ready" && state.lastSuccessAt !== null) {
    return now >= state.lastSuccessAt && now - state.lastSuccessAt < BRIDGE_CONFIRMATION_TTL_MS
      ? { label: "Last request successful", tone: "success" }
      : { label: "Confirmation expired", tone: "warning" };
  }
  return { label: state.extension === "detected" ? "Extension detected; KA unverified" : "Bridge not checked", tone: "warning" };
}
