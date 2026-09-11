const PAGE_SOURCE = "askanything-page";
const EXTENSION_SOURCE = "askanything-extension";
const ALLOWED_ORIGINS = new Set([
  "https://ask-anything-steel.vercel.app",
  "http://localhost:3000",
  "http://127.0.0.1:3000",
]);
const activeKaRequests = new Map();

function controlKaRequest(type, requestId) {
  try {
    chrome.runtime.sendMessage({ type, requestId }, () => {
      void chrome.runtime.lastError;
    });
  } catch {
    // A reloaded extension invalidates this content script.
  }
}

function finishKaRequest(requestId, cancel = false) {
  const active = activeKaRequests.get(requestId);
  if (!active) return;
  clearInterval(active.heartbeat);
  clearTimeout(active.timeout);
  activeKaRequests.delete(requestId);
  if (cancel) controlKaRequest("PROXY_KA_CANCEL", requestId);
}

function reply(requestId, payload) {
  window.postMessage(
    {
      source: EXTENSION_SOURCE,
      requestId,
      extensionId: chrome.runtime.id,
      protocolVersion: 2,
      ...payload,
    },
    window.location.origin,
  );
}

window.addEventListener("message", (event) => {
  if (
    event.source !== window ||
    event.origin !== window.location.origin ||
    !ALLOWED_ORIGINS.has(event.origin) ||
    event.data?.source !== PAGE_SOURCE
  ) {
    return;
  }

  const { requestId, type } = event.data;
  if (typeof requestId !== "string") return;
  if (event.data.extensionId && event.data.extensionId !== chrome.runtime.id) return;
  if (type === "KA_CANCEL_V2") {
    finishKaRequest(requestId, true);
    return;
  }

  if (type === "PING") {
    // El PING debe demostrar que el service worker responde, no solo que el
    // content script está inyectado: en incógnito puede fallar justo ahí.
    chrome.runtime.sendMessage({ type: "PROXY_PING" }, (response) => {
      if (chrome.runtime.lastError) {
        reply(requestId, {
          ok: false,
          error: chrome.runtime.lastError.message,
        });
        return;
      }
      reply(requestId, response?.ok ? { ok: true } : {
        ok: false,
        error: "The bridge background worker did not respond.",
      });
    });
    return;
  }

  if (type !== "KA_REQUEST" && type !== "KA_REQUEST_V2") return;
  if (type === "KA_REQUEST_V2" && event.data.extensionId !== chrome.runtime.id) return;
  if (activeKaRequests.has(requestId)) return;

  activeKaRequests.set(requestId, {
    // Scoped runtime traffic mitigates MV3 idle shutdown; it never resubmits KA.
    heartbeat: setInterval(() => controlKaRequest("PROXY_KA_HEARTBEAT", requestId), 20000),
    timeout: setTimeout(() => {
      finishKaRequest(requestId, true);
      reply(requestId, { ok: false, error: "Knowledge Assistant bridge timed out." });
    }, 190000),
  });
  try {
    chrome.runtime.sendMessage(
    {
      type: "PROXY_KA_REQUEST",
      requestId,
      messages: event.data.messages,
    },
    (response) => {
      const error = chrome.runtime.lastError;
      if (!activeKaRequests.has(requestId)) return;
      finishKaRequest(requestId, !!error || !response?.ok || typeof response.text !== "string");
      if (error) {
        reply(requestId, {
          ok: false,
          error: error.message,
        });
        return;
      }
      reply(requestId, response || {
        ok: false,
        error: "The bridge did not return a response.",
      });
    },
  );
  } catch (error) {
    finishKaRequest(requestId, true);
    reply(requestId, { ok: false, error: error.message });
  }
});

window.addEventListener("pagehide", () => {
  for (const requestId of activeKaRequests.keys()) finishKaRequest(requestId, true);
});
