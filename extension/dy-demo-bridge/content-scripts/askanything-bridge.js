const ASKANYTHING_PAGE_SOURCE = "askanything-page";
const ASKANYTHING_EXTENSION_SOURCE = "askanything-extension";
const ASKANYTHING_ALLOWED_ORIGINS = new Set([
  "https://ask-anything-steel.vercel.app",
  "http://localhost:3000",
  "http://127.0.0.1:3000",
]);
const askAnythingActiveRequests = new Map();

function controlAskAnythingRequest(type, requestId) {
  try {
    chrome.runtime.sendMessage({ type, requestId }, () => {
      void chrome.runtime.lastError;
    });
  } catch {
    // A reloaded extension invalidates this content script.
  }
}

function finishAskAnythingRequest(requestId, cancel = false) {
  const active = askAnythingActiveRequests.get(requestId);
  if (!active) return;
  clearInterval(active.heartbeat);
  clearTimeout(active.timeout);
  askAnythingActiveRequests.delete(requestId);
  if (cancel) controlAskAnythingRequest("PROXY_KA_CANCEL", requestId);
}

function replyToAskAnything(requestId, payload) {
  window.postMessage(
    {
      source: ASKANYTHING_EXTENSION_SOURCE,
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
    !ASKANYTHING_ALLOWED_ORIGINS.has(event.origin) ||
    event.data?.source !== ASKANYTHING_PAGE_SOURCE
  ) {
    return;
  }

  const { requestId, type } = event.data;
  if (typeof requestId !== "string") return;
  if (event.data.extensionId && event.data.extensionId !== chrome.runtime.id) return;
  if (type === "KA_CANCEL_V2") {
    finishAskAnythingRequest(requestId, true);
    return;
  }

  if (type === "PING") {
    // Comprobamos el service worker de verdad: que el content script esté
    // inyectado no garantiza que el puente pueda salir a KA (p. ej. incógnito).
    chrome.runtime.sendMessage({ type: "PROXY_PING" }, (response) => {
      if (chrome.runtime.lastError) {
        replyToAskAnything(requestId, {
          ok: false,
          error: chrome.runtime.lastError.message,
        });
        return;
      }
      replyToAskAnything(
        requestId,
        response?.ok
          ? { ok: true }
          : {
              ok: false,
              error: "The bridge background worker did not respond.",
            },
      );
    });
    return;
  }
  if (type !== "KA_REQUEST" && type !== "KA_REQUEST_V2") return;
  if (type === "KA_REQUEST_V2" && event.data.extensionId !== chrome.runtime.id) return;
  if (askAnythingActiveRequests.has(requestId)) return;

  askAnythingActiveRequests.set(requestId, {
    // Scoped runtime traffic mitigates MV3 idle shutdown; it never resubmits KA.
    heartbeat: setInterval(() => controlAskAnythingRequest("PROXY_KA_HEARTBEAT", requestId), 20000),
    timeout: setTimeout(() => {
      finishAskAnythingRequest(requestId, true);
      replyToAskAnything(requestId, { ok: false, error: "Knowledge Assistant bridge timed out." });
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
      if (!askAnythingActiveRequests.has(requestId)) return;
      finishAskAnythingRequest(requestId, !!error || !response?.ok || typeof response.text !== "string");
      if (error) {
        replyToAskAnything(requestId, {
          ok: false,
          error: error.message,
        });
        return;
      }
      replyToAskAnything(
        requestId,
        response || {
          ok: false,
          error: "The bridge did not return a response.",
        },
      );
    },
  );
  } catch (error) {
    finishAskAnythingRequest(requestId, true);
    replyToAskAnything(requestId, { ok: false, error: error.message });
  }
});

window.addEventListener("pagehide", () => {
  for (const requestId of askAnythingActiveRequests.keys()) finishAskAnythingRequest(requestId, true);
});
