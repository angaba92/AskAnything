# AskAnything corporate bridge (Chrome / Edge)

This extension lets the Vercel-hosted AskAnything page call the VPN-only
Knowledge Assistant from the user's browser. It works on macOS and Windows
without Node.js, a local server, certificates, or administrator privileges.

It also retains the optional one-click refresh for the legacy Dynamic Yield
session.

A bookmarklet **cannot** do this: DY's session cookie is `HttpOnly`, so page
JavaScript (`document.cookie`) can't read it. This MV3 extension uses the
privileged `chrome.cookies` API to read the full cookie header (including
HttpOnly cookies) and POSTs it to the app's `/api/dy-session` endpoint.

## Install (one time, per reviewer)

1. Open `chrome://extensions` (or `edge://extensions`).
2. Toggle **Developer mode** (top right).
3. Click **Load unpacked** and select this folder
   (`extension/dy-session-capture`).
4. Pin the extension so its icon is visible.
5. Connect to the corporate VPN and reload
   `https://ask-anything-steel.vercel.app`.

> The bridge pilot supports Chrome and Edge. Safari and Firefox are not supported.

## Use the Knowledge Assistant bridge

1. Connect to the corporate VPN.
2. Open AskAnything in Chrome or Edge.
3. Confirm the page shows **Corporate bridge connected**.
4. Ask a question normally.

After updating the extension files, click **Reload** in `chrome://extensions`,
then reload the AskAnything tab. For incognito, enable **Allow in Incognito**.
The connected indicator checks extension messaging, not VPN access; **Test
bridge** in Batch sends a real request to Knowledge Assistant.

The updated bridge waits up to 180 seconds for KA (190 seconds in the page),
does not automatically resend a timed-out generation, and forwards Stop to the
active request. If Chrome has invalidated the extension runtime, cancellation
cannot be guaranteed until its request deadline. Reload before resuming.
When both updated bridge extensions are installed, the page selects only one.

Only the exact AskAnything production origin and local development origins can
send requests through the extension. The upstream URL is fixed; the page cannot
use the extension as a general-purpose proxy.

## Refresh the legacy DY session

1. Open and **log in** to `https://adm.dynamicyield.com`.
2. Click the extension icon.
3. Set the **AskAnything app URL** (e.g. `http://localhost:3000` locally, or your
   internal/Vercel URL).
4. Click **Capture & push session**. You should see
   *"✓ Session refreshed for the whole team."*

That's it — the app now uses the fresh cookie for everyone, no restart needed.

## Notes

- The extension never stores the cookie itself; it forwards it straight to your
  app, which keeps it server-side.
- If you see *"DY rejected it"*, your DY login expired — reload the DY tab while
  logged in and click again.
- Host permissions are limited to `*.dynamicyield.com` and localhost.
