/**
 * Reads ALL cookies (including HttpOnly, which a bookmarklet/document.cookie
 * cannot see) for the Dynamic Yield admin domain and rebuilds the exact
 * `cookie` header. Then POSTs it to the AskAnything app's /api/dy-session
 * endpoint, refreshing the team's shared session in one click.
 */

const DY_DOMAIN = "adm.dynamicyield.com";
const DY_URL = `https://${DY_DOMAIN}/`;

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

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === "PUSH_DY_SESSION") {
    pushSession(msg.appBaseUrl).then(sendResponse);
    return true; // async response
  }
});
