# DY session capture (browser extension)

One-click refresh of the **shared** Dynamic Yield session used by the AskAnything
app — no more "Copy as cURL".

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

> Works in Chrome and Edge (Chromium). For Firefox, use `about:debugging` →
> "Load Temporary Add-on" and select `manifest.json`.

## Use

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
