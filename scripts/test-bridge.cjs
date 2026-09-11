const assert = require("node:assert/strict");
const { test } = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const pageCode = ts.transpileModule(read("src/lib/extensionBridge.ts"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const bridges = [
  ["session capture", "extension/dy-session-capture/content.js", "extension/dy-session-capture/background.js"],
  ["demo bridge", "extension/dy-demo-bridge/content-scripts/askanything-bridge.js", "extension/dy-demo-bridge/bridge-background.js"],
];
const flush = async () => {
  for (let i = 0; i < 30; i++) await Promise.resolve();
};

// Each test isolates the page, content scripts and workers, sharing only their message bus.
function setup() {
  let now = 0;
  let sequence = 0;
  const timers = new Map();
  const listeners = new Map();
  const posts = [];
  const fetches = [];
  const runtimeMessages = [];
  const schedule = (fn, ms, repeat = false) => {
    const id = ++sequence;
    timers.set(id, { fn, at: now + ms, ms, repeat });
    return id;
  };
  const clear = (id) => timers.delete(id);
  const clock = {
    setTimeout: (fn, ms) => schedule(fn, ms),
    clearTimeout: clear,
    setInterval: (fn, ms) => schedule(fn, ms, true),
    clearInterval: clear,
  };
  const window = {
    location: { origin: "http://localhost:3000" },
    ...clock,
    addEventListener(type, fn) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(fn);
    },
    removeEventListener: (type, fn) => listeners.get(type)?.delete(fn),
    postMessage(data) {
      posts.push(data);
      queueMicrotask(() => {
        for (const fn of [...(listeners.get("message") || [])]) {
          fn({ source: window, origin: window.location.origin, data });
        }
      });
    },
  };
  const shared = { window, console, AbortController, DOMException, URL, Error, ...clock };
  const exports = {};
  vm.runInNewContext(pageCode, {
    ...shared,
    exports,
    crypto: { randomUUID: () => `request-${++sequence}` },
    require: (name) => {
      assert.equal(name, "./promptMapping");
      return { buildKaUserContent: (question) => question };
    },
  });

  function addLegacy() {
    window.addEventListener("message", ({ data }) => {
      if (data.source !== "askanything-page") return;
      if (data.type === "PING" || data.type === "KA_REQUEST") {
        window.postMessage({
          source: "askanything-extension", requestId: data.requestId, ok: true,
          ...(data.type === "KA_REQUEST" ? { text: "legacy" } : {}),
        });
      }
    });
  }

  function addExtension(bridge, id) {
    let handler;
    let disconnected = false;
    const callbacks = new Map();
    const sender = { tab: { id: 1, url: window.location.origin }, frameId: 0, documentId: "document" };
    const chrome = {
      runtime: {
        id,
        lastError: undefined,
        onMessage: { addListener: (fn) => { handler = fn; } },
        sendMessage(message, callback) {
          runtimeMessages.push({ id, ...message });
          if (disconnected) throw new Error("Extension context invalidated.");
          if (message.type === "PROXY_KA_REQUEST") callbacks.set(message.requestId, callback);
          handler(message, sender, callback);
        },
      },
    };
    const fetch = (_url, options) => new Promise((resolve, reject) => {
      fetches.push({
        id, options, reject,
        resolve: () => resolve({ ok: true, text: async () => "answer" }),
      });
      options.signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
    });
    vm.runInNewContext(read(bridge[2]), { ...shared, chrome, fetch });
    vm.runInNewContext(read(bridge[1]), { ...shared, chrome });
    return {
      handler: (...args) => handler(...args),
      sender,
      closeChannel(requestId, { deadRuntime = false, emptyResponse = false } = {}) {
        disconnected = deadRuntime;
        chrome.runtime.lastError = emptyResponse ? undefined : { message: "The message channel closed before a response was received." };
        try {
          callbacks.get(requestId)(undefined);
        } finally {
          chrome.runtime.lastError = undefined;
        }
      },
    };
  }

  async function tick(ms) {
    const end = now + ms;
    while (true) {
      const entry = [...timers].filter(([, timer]) => timer.at <= end)
        .sort((a, b) => a[1].at - b[1].at)[0];
      if (!entry) break;
      const [id, timer] = entry;
      now = timer.at;
      if (timer.repeat) timer.at += timer.ms;
      else timers.delete(id);
      timer.fn();
      await flush();
    }
    now = end;
    await flush();
  }
  return { exports, window, posts, fetches, timers, listeners, runtimeMessages, addExtension, addLegacy, tick };
}

function fixture(index) {
  const state = setup();
  state.addLegacy();
  const worker = state.addExtension(bridges[index], "selected");
  state.addExtension(bridges[1 - index], "other");
  const baseline = state.listeners.get("message").size;
  return {
    ...state,
    worker,
    ask: (signal) => state.exports.askKaViaExtension("Question?", { mode: "loopio", signal }),
    request: () => state.posts.find((message) => message.type === "KA_REQUEST_V2"),
    clean() {
      assert.equal(state.timers.size, 0);
      assert.equal(state.listeners.get("message").size, baseline);
    },
  };
}

for (const [index, [name]] of bridges.entries()) {
  test(`${name}: selects one extension alongside modern and legacy peers; survives 80 seconds`, async () => {
    const state = fixture(index);
    const result = state.ask();
    await flush();
    assert.equal(state.fetches.length, 1);
    assert.equal(state.fetches[0].id, "selected");
    assert.equal(state.posts.filter((message) => message.type === "KA_REQUEST_V2").length, 1);
    assert.equal(state.posts.filter((message) => message.type === "KA_REQUEST").length, 0);
    await state.tick(80000);
    assert.equal(state.fetches.length, 1);
    assert.equal(state.runtimeMessages.filter((message) => message.type === "PROXY_KA_HEARTBEAT").length, 4);
    state.fetches[0].resolve();
    assert.equal(await result, "answer");
    await flush();
    state.clean();
  });

  test(`${name}: abort reaches the worker and cleans up`, async () => {
    const state = fixture(index);
    const controller = new AbortController();
    const result = state.ask(controller.signal);
    await flush();
    const rejected = assert.rejects(result, { name: "AbortError" });
    controller.abort();
    await rejected;
    await flush();
    assert.equal(state.fetches[0].options.signal.aborted, true);
    assert.equal(state.fetches.length, 1);
    state.clean();
  });

  test(`${name}: worker deadline is 180 seconds without resubmission`, async () => {
    const state = fixture(index);
    const result = state.ask();
    await flush();
    const rejected = assert.rejects(result, /180 seconds/);
    await state.tick(180000);
    await rejected;
    assert.equal(state.fetches.length, 1);
    assert.equal(state.fetches[0].options.signal.aborted, true);
    state.clean();
  });

  test(`${name}: network failure clears the worker deadline without retry`, async () => {
    const state = fixture(index);
    const result = state.ask();
    await flush();
    const rejected = assert.rejects(result, /Could not reach/);
    state.fetches[0].reject(new Error("network down"));
    await rejected;
    await flush();
    assert.equal(state.fetches.length, 1);
    state.clean();
  });

  test(`${name}: already aborted signal dispatches nothing`, async () => {
    const state = fixture(index);
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(state.ask(controller.signal), { name: "AbortError" });
    assert.equal(state.fetches.length, 0);
    assert.equal(state.posts.length, 0);
    state.clean();
  });

  test(`${name}: another tab cannot cancel the request`, async () => {
    const state = fixture(index);
    const result = state.ask();
    await flush();
    state.worker.handler(
      { type: "PROXY_KA_CANCEL", requestId: state.request().requestId },
      { ...state.worker.sender, tab: { ...state.worker.sender.tab, id: 2 } },
      () => {},
    );
    assert.equal(state.fetches[0].options.signal.aborted, false);
    state.fetches[0].resolve();
    assert.equal(await result, "answer");
    await flush();
    state.clean();
  });

  for (const scenario of [
    { label: "closed channel", options: {}, error: /channel closed/ },
    { label: "empty runtime response", options: { emptyResponse: true }, error: /did not return a response/ },
    { label: "invalidated runtime", options: { deadRuntime: true }, error: /channel closed/ },
  ]) {
    test(`${name}: ${scenario.label} attempts cancellation and rejects without retry`, async () => {
      const state = fixture(index);
      const result = state.ask();
      await flush();
      const rejected = assert.rejects(result, scenario.error);
      const { requestId } = state.request();
      state.worker.closeChannel(requestId, scenario.options);
      await rejected;
      await flush();
      assert.equal(state.fetches.length, 1);
      assert.ok(state.runtimeMessages.some((message) =>
        message.type === "PROXY_KA_CANCEL" && message.requestId === requestId));
      assert.ok(state.posts.some((message) =>
        message.type === "KA_CANCEL_V2" && message.requestId === requestId && message.extensionId === "selected"));
      if (scenario.options.deadRuntime) {
        // Cancellation delivery is impossible after runtime loss; the worker deadline still bounds it.
        assert.equal(state.fetches[0].options.signal.aborted, false);
        assert.equal(state.timers.size, 1);
        await state.tick(180000);
      }
      assert.equal(state.fetches[0].options.signal.aborted, true);
      state.clean();
    });
  }
}

test("unmodified legacy extension responds normally after discovery", async () => {
  const state = setup();
  state.addLegacy();
  const baseline = state.listeners.get("message").size;
  const result = state.exports.askKaViaExtension("Question?", { mode: "loopio" });
  await flush();
  await state.tick(5000);
  assert.equal(await result, "legacy");
  assert.equal(state.posts.filter((message) => message.type === "KA_REQUEST").length, 1);
  assert.equal(state.timers.size, 0);
  assert.equal(state.listeners.get("message").size, baseline);
});

test("page ignores wrong extension identity, cancels at 190 seconds and never retries", async () => {
  const state = setup();
  state.window.addEventListener("message", ({ data }) => {
    if (data.type === "PING") state.window.postMessage({
      source: "askanything-extension", requestId: data.requestId,
      ok: true, extensionId: "selected", protocolVersion: 2,
    });
  });
  const baseline = state.listeners.get("message").size;
  const result = state.exports.askKaViaExtension("Question?", { mode: "loopio" });
  await flush();
  const request = state.posts.find((message) => message.type === "KA_REQUEST_V2");
  state.window.postMessage({
    source: "askanything-extension", requestId: request.requestId,
    extensionId: "wrong", ok: true, text: "wrong answer",
  });
  await flush();
  const rejected = assert.rejects(result, /190 seconds/);
  await state.tick(190000);
  await rejected;
  assert.equal(state.posts.filter((message) => message.type === "KA_REQUEST_V2").length, 1);
  assert.equal(state.posts.filter((message) => message.type === "KA_CANCEL_V2").length, 1);
  assert.equal(state.timers.size, 0);
  assert.equal(state.listeners.get("message").size, baseline);
});
