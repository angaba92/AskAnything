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
}

function requestBridge(
  type: "PING" | "KA_REQUEST",
  payload: Record<string, unknown> = {},
  timeoutMs = 1500,
): Promise<BridgeResponse> {
  const requestId = crypto.randomUUID();

  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => {
      window.removeEventListener("message", onMessage);
      reject(new Error("AskAnything corporate bridge is not connected."));
    }, timeoutMs);

    function onMessage(event: MessageEvent<BridgeResponse>) {
      if (
        event.source !== window ||
        event.origin !== window.location.origin ||
        event.data?.source !== EXTENSION_SOURCE ||
        event.data.requestId !== requestId
      ) {
        return;
      }
      window.clearTimeout(timer);
      window.removeEventListener("message", onMessage);
      resolve(event.data);
    }

    window.addEventListener("message", onMessage);
    window.postMessage(
      {
        source: PAGE_SOURCE,
        requestId,
        type,
        ...payload,
      },
      window.location.origin,
    );
  });
}

export async function isExtensionBridgeAvailable(): Promise<boolean> {
  try {
    // El PING ahora hace ida y vuelta hasta el service worker, que puede estar
    // dormido: 1,5 s se quedaba corto y daba falsos "no conectado".
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
  },
): Promise<string> {
  const content = buildKaUserContent(question, opts);
  const payload = { messages: [{ role: "user", content }] };

  // KA responde en ~20s. Un timeout corto deja de confundir "service worker
  // dormido" (típico en incógnito) con "KA lento": si falla, despertamos el
  // worker con un PING y reintentamos una sola vez.
  const attempt = () => requestBridge("KA_REQUEST", payload, 120000);

  let response: BridgeResponse;
  try {
    response = await attempt();
  } catch (firstError) {
    await isExtensionBridgeAvailable();
    try {
      response = await attempt();
    } catch {
      throw firstError instanceof Error
        ? firstError
        : new Error("Knowledge Assistant bridge failed.");
    }
  }

  if (!response.ok || typeof response.text !== "string") {
    throw new Error(response.error || "Knowledge Assistant bridge failed.");
  }
  return response.text;
}
