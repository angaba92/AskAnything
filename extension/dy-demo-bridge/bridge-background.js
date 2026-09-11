const ASKANYTHING_KA_ENDPOINT =
  "https://dy-knowledge-assistant.use1.dev.dydy.io/api/chat";
const ASKANYTHING_ORIGINS = new Set([
  "https://ask-anything-steel.vercel.app",
  "http://localhost:3000",
  "http://127.0.0.1:3000",
]);

function askAnythingSenderOrigin(sender) {
  try {
    return new URL(sender.tab?.url || "").origin;
  } catch {
    return "";
  }
}

function validAskAnythingMessages(messages) {
  return (
    Array.isArray(messages) &&
    messages.length > 0 &&
    messages.length <= 20 &&
    messages.every(
      (message) =>
        (message?.role === "user" || message?.role === "assistant") &&
        typeof message.content === "string" &&
        message.content.length > 0 &&
        message.content.length <= 50000,
    )
  );
}

const askAnythingControllers = new Map();

function askAnythingRequestKey(requestId, sender) {
  return JSON.stringify([sender.tab?.id, sender.frameId, sender.documentId, requestId]);
}

async function proxyAskAnythingRequest(messages, sender, requestId) {
  if (!ASKANYTHING_ORIGINS.has(askAnythingSenderOrigin(sender))) {
    return { ok: false, error: "Request rejected: untrusted app origin." };
  }
  if (!validAskAnythingMessages(messages)) {
    return { ok: false, error: "Request rejected: invalid message payload." };
  }

  const key = typeof requestId === "string" ? askAnythingRequestKey(requestId, sender) : null;
  if (key && askAnythingControllers.has(key)) return { ok: false, error: "Request already active." };
  const controller = new AbortController();
  if (key) askAnythingControllers.set(key, controller);
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, 180000);
  try {
    const response = await fetch(ASKANYTHING_KA_ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ messages }),
      signal: controller.signal,
    });
    const text = await response.text();
    if (!response.ok) {
      return {
        ok: false,
        error: `Knowledge Assistant returned HTTP ${response.status}.`,
      };
    }
    return { ok: true, text };
  } catch (error) {
    if (controller.signal.aborted) {
      return { ok: false, error: timedOut
        ? "Knowledge Assistant timed out after 180 seconds."
        : "Knowledge Assistant request cancelled." };
    }
    return {
      ok: false,
      error:
        "Could not reach Knowledge Assistant. " +
        "Connect to the corporate VPN and retry. " +
        (error instanceof Error ? error.message : ""),
    };
  } finally {
    clearTimeout(timeout);
    if (key) askAnythingControllers.delete(key);
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "PROXY_KA_CANCEL" || message?.type === "PROXY_KA_HEARTBEAT") {
    if (!ASKANYTHING_ORIGINS.has(askAnythingSenderOrigin(sender)) || typeof message.requestId !== "string") {
      sendResponse({ ok: false });
      return false;
    }
    const controller = askAnythingControllers.get(askAnythingRequestKey(message.requestId, sender));
    if (message.type === "PROXY_KA_CANCEL") controller?.abort();
    sendResponse({ ok: true, active: !!controller });
    return false;
  }
  if (message?.type === "PROXY_PING") {
    sendResponse({ ok: true });
    return false;
  }
  if (message?.type !== "PROXY_KA_REQUEST") return;
  proxyAskAnythingRequest(message.messages, sender, message.requestId).then(sendResponse);
  return true;
});
