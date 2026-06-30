const appUrlEl = document.getElementById("appUrl");
const pushBtn = document.getElementById("push");
const msgEl = document.getElementById("msg");

const DEFAULT_URL = "http://localhost:3000";

// Restore the last used app URL.
chrome.storage.sync.get(["appBaseUrl"], ({ appBaseUrl }) => {
  appUrlEl.value = appBaseUrl || DEFAULT_URL;
});

function setMsg(text, kind) {
  msgEl.textContent = text;
  msgEl.className = "msg" + (kind ? " " + kind : "");
}

pushBtn.addEventListener("click", async () => {
  const appBaseUrl = appUrlEl.value.trim();
  if (!appBaseUrl) {
    setMsg("Enter the AskAnything app URL.", "err");
    return;
  }
  chrome.storage.sync.set({ appBaseUrl });

  pushBtn.disabled = true;
  setMsg("Capturing cookie and pushing…");

  const res = await chrome.runtime.sendMessage({
    type: "PUSH_DY_SESSION",
    appBaseUrl,
  });

  pushBtn.disabled = false;

  if (!res) {
    setMsg("No response from the extension. Reload it and retry.", "err");
    return;
  }
  if (!res.ok) {
    setMsg("✗ " + res.error, "err");
    return;
  }
  const info = res.info || {};
  if (info.tested && info.valid === false) {
    setMsg(
      "Session saved, but DY rejected it (it may be expired). Re-login to DY and retry.\n" +
        (info.message || ""),
      "err"
    );
  } else {
    setMsg("✓ Session refreshed for the whole team.", "ok");
  }
});
