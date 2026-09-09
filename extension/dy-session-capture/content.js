const PAGE_SOURCE = "askanything-page";
const EXTENSION_SOURCE = "askanything-extension";
const ALLOWED_ORIGINS = new Set([
  "https://ask-anything-steel.vercel.app",
  "http://localhost:3000",
  "http://127.0.0.1:3000",
]);

function reply(requestId, payload) {
  window.postMessage(
    {
      source: EXTENSION_SOURCE,
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
    !ALLOWED_ORIGINS.has(event.origin) ||
    event.data?.source !== PAGE_SOURCE
  ) {
    return;
  }

  const { requestId, type } = event.data;
  if (typeof requestId !== "string") return;

  if (type === "PING") {
    reply(requestId, { ok: true });
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
        reply(requestId, {
          ok: false,
          error: chrome.runtime.lastError.message,
        });
        return;
      }
      reply(requestId, response || {
        ok: false,
        error: "The bridge did not return a response.",
      });
    },
  );
});
