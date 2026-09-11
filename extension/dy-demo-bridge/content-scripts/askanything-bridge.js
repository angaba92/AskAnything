const ASKANYTHING_PAGE_SOURCE = "askanything-page";
const ASKANYTHING_EXTENSION_SOURCE = "askanything-extension";
const ASKANYTHING_ALLOWED_ORIGINS = new Set([
  "https://ask-anything-steel.vercel.app",
  "http://localhost:3000",
  "http://127.0.0.1:3000",
]);

function replyToAskAnything(requestId, payload) {
  window.postMessage(
    {
      source: ASKANYTHING_EXTENSION_SOURCE,
      requestId,
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
  if (type !== "KA_REQUEST") return;

  chrome.runtime.sendMessage(
    {
      type: "PROXY_KA_REQUEST",
      messages: event.data.messages,
    },
    (response) => {
      if (chrome.runtime.lastError) {
        replyToAskAnything(requestId, {
          ok: false,
          error: chrome.runtime.lastError.message,
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
});
