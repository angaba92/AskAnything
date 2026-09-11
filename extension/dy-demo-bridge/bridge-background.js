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

async function proxyAskAnythingRequest(messages, sender) {
  if (!ASKANYTHING_ORIGINS.has(askAnythingSenderOrigin(sender))) {
    return { ok: false, error: "Request rejected: untrusted app origin." };
  }
  if (!validAskAnythingMessages(messages)) {
    return { ok: false, error: "Request rejected: invalid message payload." };
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 180000);
    const response = await fetch(ASKANYTHING_KA_ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ messages }),
      signal: controller.signal,
    });
    const text = await response.text();
    clearTimeout(timeout);
    if (!response.ok) {
      return {
        ok: false,
        error: `Knowledge Assistant returned HTTP ${response.status}.`,
      };
    }
    return { ok: true, text };
  } catch (error) {
    return {
      ok: false,
      error:
        (error?.name === "AbortError"
          ? "Knowledge Assistant timed out after 40 seconds. "
          : "Could not reach Knowledge Assistant. ") +
        "Connect to the corporate VPN and retry. " +
        (error instanceof Error ? error.message : ""),
    };
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "PROXY_PING") {
    sendResponse({ ok: true });
    return false;
  }
  if (message?.type !== "PROXY_KA_REQUEST") return;
  proxyAskAnythingRequest(message.messages, sender).then(sendResponse);
  return true;
});
