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

async function proxyAskAnythingRequest(messages, sender, requestId, requestController) {
  if (!ASKANYTHING_ORIGINS.has(askAnythingSenderOrigin(sender))) {
    return { ok: false, error: "Request rejected: untrusted app origin." };
  }
  if (!validAskAnythingMessages(messages)) {
    return { ok: false, error: "Request rejected: invalid message payload." };
  }

  const key = typeof requestId === "string" ? askAnythingRequestKey(requestId, sender) : null;
  if (key && askAnythingControllers.has(key)) return { ok: false, error: "Request already active." };
  const controller = requestController || new AbortController();
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

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "askanything-ka") return;
  const sender = port.sender;
  if (!sender || !ASKANYTHING_ORIGINS.has(askAnythingSenderOrigin(sender))) {
    try {
      port.disconnect();
    } catch (error) {
      console.warn("Could not close an untrusted KA port.", error);
    }
    return;
  }
  let requestId;
  let closed = false;
  let heartbeat;
  let finishTimeout;
  let controller;
  const close = (disconnect = true) => {
    if (closed) return;
    closed = true;
    clearInterval(heartbeat);
    clearTimeout(startTimeout);
    clearTimeout(finishTimeout);
    port.onMessage.removeListener(onMessage);
    port.onDisconnect.removeListener(onDisconnect);
    controller?.abort();
    if (disconnect) {
      try {
        port.disconnect();
      } catch (error) {
        console.warn("Could not disconnect the closed KA worker port.", error);
      }
    }
  };
  const send = (message) => {
    if (closed) return false;
    try {
      port.postMessage({ ...message, requestId });
      return true;
    } catch (error) {
      console.warn("KA worker port send failed; cancelling its request.", error);
      close();
      return false;
    }
  };
  const complete = (result) => {
    clearInterval(heartbeat);
    if (send({ type: "RESULT", ...result })) {
      port.onMessage.removeListener(onMessage);
      // Let the result arrive before disconnecting; bound cleanup if the tab is gone.
      finishTimeout = setTimeout(() => close(), 10000);
    }
  };
  const onDisconnect = () => {
    const error = chrome.runtime.lastError;
    if (error) console.warn("KA worker port disconnected.", error.message);
    close(false);
  };
  const onMessage = (message) => {
    if (closed || message?.type !== "START" || requestId) return;
    clearTimeout(startTimeout);
    if (typeof message.requestId !== "string" || !message.requestId) {
      send({ type: "RESULT", ok: false, error: "Invalid bridge request ID." });
      close();
      return;
    }
    requestId = message.requestId;
    // Own the controller, not just its lookup key: a duplicate port must never cancel its peer.
    controller = new AbortController();
    heartbeat = setInterval(() => send({ type: "HEARTBEAT" }), 20000);
    proxyAskAnythingRequest(message.messages, sender, requestId, controller).then(
      complete,
      (error) => complete({ ok: false, error: `Knowledge Assistant bridge failed: ${error.message}` }),
    );
  };
  const startTimeout = setTimeout(() => close(), 5000);
  port.onDisconnect.addListener(onDisconnect);
  port.onMessage.addListener(onMessage);
});

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
  const respond = (result) => {
    try {
      sendResponse(result);
    } catch (error) {
      console.warn("Legacy KA response channel closed after completion.", error);
    }
  };
  proxyAskAnythingRequest(message.messages, sender, message.requestId).then(
    respond,
    (error) => respond({ ok: false, error: `Knowledge Assistant bridge failed: ${error.message}` }),
  );
  return true;
});
