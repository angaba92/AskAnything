"use client";

import { buildKaUserContent, type AnswerMode } from "./promptMapping";

const PAGE_SOURCE = "askanything-page";
const EXTENSION_SOURCE = "askanything-extension";

interface BridgeResponse {
  source: typeof EXTENSION_SOURCE;
  requestId: string;
  ok: boolean;
  text?: string;
  error?: string;
  extensionId?: string;
  protocolVersion?: number;
}

async function requestBridge(
  type: "PING" | "KA_REQUEST" | "KA_REQUEST_V2",
  payload: Record<string, unknown> = {},
  timeoutMs = 1500,
  signal?: AbortSignal,
): Promise<BridgeResponse> {
  const requestId = crypto.randomUUID();
  let timer: number | undefined;
  let onMessage: ((event: MessageEvent<BridgeResponse>) => void) | undefined;
  let onAbort: (() => void) | undefined;
  let sent = false;
  try {
    return await new Promise<BridgeResponse>((resolve, reject) => {
      let legacyResponse: BridgeResponse | undefined;
      onAbort = () => reject(new DOMException("Knowledge Assistant request cancelled.", "AbortError"));
      if (signal?.aborted) {
        onAbort();
        return;
      }
      timer = window.setTimeout(() => {
        if (legacyResponse) resolve(legacyResponse);
        else reject(new Error(type === "PING"
          ? "AskAnything corporate bridge is not connected."
          : "Knowledge Assistant bridge timed out after 190 seconds. No request was retried."));
      }, timeoutMs);
      onMessage = (event) => {
        if (
          event.source !== window ||
          event.origin !== window.location.origin ||
          event.data?.source !== EXTENSION_SOURCE ||
          event.data.requestId !== requestId ||
          (payload.extensionId && event.data.extensionId !== payload.extensionId)
        ) return;
        if (type === "PING") {
          if (!event.data.ok) return;
          // Prefer a targetable bridge, but retain compatibility until old extensions reload.
          if (event.data.protocolVersion !== 2 || !event.data.extensionId) {
            legacyResponse = event.data;
            return;
          }
        } else if (!event.data.ok || typeof event.data.text !== "string") {
          reject(new Error(event.data.error || "Knowledge Assistant bridge failed."));
          return;
        }
        resolve(event.data);
      };
      window.addEventListener("message", onMessage);
      signal?.addEventListener("abort", onAbort, { once: true });
      sent = true;
      window.postMessage({ ...payload, source: PAGE_SOURCE, requestId, type }, window.location.origin);
    });
  } catch (error) {
    if (sent && type !== "PING") {
      try {
        window.postMessage({
          source: PAGE_SOURCE, requestId, type: "KA_CANCEL_V2",
          extensionId: payload.extensionId,
        }, window.location.origin);
      } catch {
        // Preserve the original failure if the page transport has also closed.
      }
    }
    throw error;
  } finally {
    if (timer !== undefined) window.clearTimeout(timer);
    if (onMessage) window.removeEventListener("message", onMessage);
    if (onAbort) signal?.removeEventListener("abort", onAbort);
  }
}

export async function isExtensionBridgeAvailable(): Promise<boolean> {
  try {
    // Check the background worker, not just the injected content script.
    const response = await requestBridge("PING", {}, 5000);
    return response.ok;
  } catch {
    return false;
  }
}

export async function askKaViaExtension(
  question: string,
  opts: {
    mode: AnswerMode;
    context?: string;
    confidenceReview?: boolean;
    customPrompt?: string;
    signal?: AbortSignal;
  },
): Promise<string> {
  const content = buildKaUserContent(question, opts);
  const payload = { messages: [{ role: "user", content }] };

  const bridge = await requestBridge("PING", {}, 5000, opts.signal);
  const targeted = bridge.protocolVersion === 2 && !!bridge.extensionId;
  // A distinct request type prevents older, untargetable extensions from also fetching KA.
  const response = await requestBridge(
    targeted ? "KA_REQUEST_V2" : "KA_REQUEST",
    targeted ? { ...payload, extensionId: bridge.extensionId } : payload,
    190000,
    opts.signal,
  );

  if (!response.ok || typeof response.text !== "string") {
    throw new Error(response.error || "Knowledge Assistant bridge failed.");
  }
  return response.text;
}
