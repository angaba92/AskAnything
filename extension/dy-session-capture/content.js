const PAGE_SOURCE = "askanything-page";
const EXTENSION_SOURCE = "askanything-extension";
const ALLOWED_ORIGINS = new Set([
  "https://ask-anything-steel.vercel.app",
  "http://localhost:3000",
  "http://127.0.0.1:3000",
]);
const activeKaRequests = new Map();
const bridgeExtensionId = chrome.runtime.id;
const bridgeVersion = chrome.runtime.getManifest().version;

function finishKaRequest(requestId, disconnect = true) {
  const active = activeKaRequests.get(requestId);
  if (!active) return;
  clearTimeout(active.timeout);
  activeKaRequests.delete(requestId);
  active.port.onMessage.removeListener(active.onMessage);
  active.port.onDisconnect.removeListener(active.onDisconnect);
  if (disconnect) {
    try {
      active.port.disconnect();
    } catch (error) {
      console.warn("Could not disconnect the KA port; the worker deadline remains in force.", error);
      try {
        chrome.runtime.sendMessage({ type: "PROXY_KA_CANCEL", requestId }, () => {
          const failure = chrome.runtime.lastError;
          if (failure) console.warn("KA cancellation fallback failed.", failure.message);
        });
      } catch (failure) {
        console.warn("KA cancellation fallback could not reach the worker.", failure);
      }
    }
  }
}

function reply(requestId, payload) {
  window.postMessage(
    {
      source: EXTENSION_SOURCE,
      requestId,
      extensionId: bridgeExtensionId,
      protocolVersion: 2,
      transport: "port",
      extensionVersion: bridgeVersion,
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
  if (event.data.extensionId && event.data.extensionId !== bridgeExtensionId) return;
  if (type === "KA_CANCEL_V2") {
    finishKaRequest(requestId);
    return;
  }

  if (type === "PING") {
    try {
      chrome.runtime.sendMessage({ type: "PROXY_PING" }, (response) => {
        const error = chrome.runtime.lastError;
        reply(requestId, response?.ok && !error ? { ok: true } : {
          ok: false,
          error: error?.message || "The bridge background worker did not respond.",
        });
      });
    } catch (error) {
      reply(requestId, { ok: false, error: `${error.message} Reload the extension and this tab.` });
    }
    return;
  }

  if (type !== "KA_REQUEST" && type !== "KA_REQUEST_V2") return;
  if (type === "KA_REQUEST_V2" && event.data.extensionId !== bridgeExtensionId) return;
  if (activeKaRequests.has(requestId)) return;

  try {
    const port = chrome.runtime.connect({ name: "askanything-ka" });
    const onDisconnect = () => {
      const reason = chrome.runtime.lastError?.message;
      if (!activeKaRequests.has(requestId)) return;
      finishKaRequest(requestId, false);
      reply(requestId, {
        ok: false,
        error: `Corporate bridge disconnected before KA completed${reason ? `: ${reason}` : "."} No request was retried. Reload the extension and this tab before resuming.`,
      });
    };
    const onMessage = (response) => {
      if (!activeKaRequests.has(requestId) || response?.requestId !== requestId) return;
      if (response?.type === "HEARTBEAT") {
        // One reply per worker heartbeat; no timer in the backgrounded page.
        try {
          port.postMessage({ type: "HEARTBEAT_ACK", requestId });
        } catch (error) {
          finishKaRequest(requestId);
          reply(requestId, { ok: false, error: `Corporate bridge heartbeat failed: ${error.message}. No request was retried. Reload the extension and this tab.` });
        }
        return;
      }
      if (response?.type !== "RESULT") return;
      finishKaRequest(requestId);
      reply(requestId, response);
    };
    activeKaRequests.set(requestId, {
      port, onMessage, onDisconnect,
      timeout: setTimeout(() => {
        finishKaRequest(requestId);
        reply(requestId, { ok: false, error: "Knowledge Assistant bridge timed out. No request was retried." });
      }, 190000),
    });
    port.onDisconnect.addListener(onDisconnect);
    port.onMessage.addListener(onMessage);
    port.postMessage({ type: "START", requestId, messages: event.data.messages });
  } catch (error) {
    finishKaRequest(requestId);
    reply(requestId, { ok: false, error: `${error.message} Reload the extension and this tab.` });
  }
});

window.addEventListener("pagehide", () => {
  for (const requestId of activeKaRequests.keys()) finishKaRequest(requestId);
});
