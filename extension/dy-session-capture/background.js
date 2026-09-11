/**
 * Reads ALL cookies (including HttpOnly, which a bookmarklet/document.cookie
 * cannot see) for the Dynamic Yield admin domain and rebuilds the exact
 * `cookie` header. Then POSTs it to the AskAnything app's /api/dy-session
 * endpoint, refreshing the team's shared session in one click.
 */

const DY_DOMAIN = "adm.dynamicyield.com";
const DY_URL = `https://${DY_DOMAIN}/`;
const KA_ENDPOINT =
  "https://dy-knowledge-assistant.use1.dev.dydy.io/api/chat";
const APP_ORIGINS = new Set([
  "https://ask-anything-steel.vercel.app",
  "http://localhost:3000",
  "http://127.0.0.1:3000",
]);

/** Build the full `cookie` header string from chrome.cookies for the DY domain. */
async function buildCookieHeader() {
  // url-based read returns the cookies that would be sent to that URL,
  // including HttpOnly ones, which is exactly the header DY expects.
  const cookies = await chrome.cookies.getAll({ url: DY_URL });
  if (!cookies || cookies.length === 0) return "";
  return cookies.map((c) => `${c.name}=${c.value}`).join("; ");
}

function hasXsrf(cookie) {
  return /(?:^|;\s*)XSRF-TOKEN=/i.test(cookie);
}

/** Push the cookie header to the configured AskAnything app. */
async function pushSession(appBaseUrl) {
  const cookie = await buildCookieHeader();
  if (!cookie) {
    return { ok: false, error: "No DY cookies found. Open and log in to adm.dynamicyield.com first." };
  }
  if (!hasXsrf(cookie)) {
    return { ok: false, error: "Cookie has no XSRF-TOKEN. Reload the DY tab while logged in, then retry." };
  }
  const base = (appBaseUrl || "").replace(/\/+$/, "");
  if (!base) return { ok: false, error: "Set the AskAnything app URL first." };

  try {
    const res = await fetch(`${base}/api/dy-session`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ input: cookie }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return { ok: false, error: data.error || `App returned ${res.status}` };
    }
    return { ok: true, info: data };
  } catch (e) {
    return { ok: false, error: `Could not reach the app: ${e.message}` };
  }
}

function validKaMessages(messages) {
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

function senderOrigin(sender) {
  try {
    return new URL(sender.tab?.url || "").origin;
  } catch {
    return "";
  }
}

const kaControllers = new Map();

function kaRequestKey(requestId, sender) {
  return JSON.stringify([sender.tab?.id, sender.frameId, sender.documentId, requestId]);
}

async function proxyKaRequest(messages, sender, requestId, requestController) {
  if (!APP_ORIGINS.has(senderOrigin(sender))) {
    return { ok: false, error: "Request rejected: untrusted app origin." };
  }
  if (!validKaMessages(messages)) {
    return { ok: false, error: "Request rejected: invalid message payload." };
  }

  const key = typeof requestId === "string" ? kaRequestKey(requestId, sender) : null;
  if (key && kaControllers.has(key)) return { ok: false, error: "Request already active." };
  const controller = requestController || new AbortController();
  if (key) kaControllers.set(key, controller);
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, 180000);
  try {
    const res = await fetch(KA_ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ messages }),
      signal: controller.signal,
    });
    const text = await res.text();
    if (!res.ok) {
      return {
        ok: false,
        error: `Knowledge Assistant returned HTTP ${res.status}.`,
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
    if (key) kaControllers.delete(key);
  }
}

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "askanything-ka") return;
  const sender = port.sender;
  if (!sender || !APP_ORIGINS.has(senderOrigin(sender))) {
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
    proxyKaRequest(message.messages, sender, requestId, controller).then(
      complete,
      (error) => complete({ ok: false, error: `Knowledge Assistant bridge failed: ${error.message}` }),
    );
  };
  const startTimeout = setTimeout(() => close(), 5000);
  port.onDisconnect.addListener(onDisconnect);
  port.onMessage.addListener(onMessage);
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type === "PROXY_KA_CANCEL" || msg?.type === "PROXY_KA_HEARTBEAT") {
    if (!APP_ORIGINS.has(senderOrigin(sender)) || typeof msg.requestId !== "string") {
      sendResponse({ ok: false });
      return false;
    }
    const controller = kaControllers.get(kaRequestKey(msg.requestId, sender));
    if (msg.type === "PROXY_KA_CANCEL") controller?.abort();
    sendResponse({ ok: true, active: !!controller });
    return false;
  }
  if (msg?.type === "PROXY_PING") {
    sendResponse({ ok: true });
    return false;
  }
  if (msg?.type === "PUSH_DY_SESSION") {
    pushSession(msg.appBaseUrl).then(sendResponse);
    return true; // async response
  }
  if (msg?.type === "PROXY_KA_REQUEST") {
    const respond = (result) => {
      try {
        sendResponse(result);
      } catch (error) {
        console.warn("Legacy KA response channel closed after completion.", error);
      }
    };
    proxyKaRequest(msg.messages, sender, msg.requestId).then(
      respond,
      (error) => respond({ ok: false, error: `Knowledge Assistant bridge failed: ${error.message}` }),
    );
    return true;
  }
});
