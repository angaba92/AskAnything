const assert = require("node:assert/strict");
const { test } = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");
require.extensions[".ts"] = (module, filename) => module._compile(
  ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, filename,
);

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const pageCode = ts.transpileModule(read("src/lib/extensionBridge.ts"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const healthExports = {};
vm.runInNewContext(ts.transpileModule(read("src/lib/bridgeHealth.ts"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, { exports: healthExports });
const bridges = [
  ["session capture", "extension/dy-session-capture/content.js", "extension/dy-session-capture/background.js", "extension/dy-session-capture/manifest.json"],
  ["demo bridge", "extension/dy-demo-bridge/content-scripts/askanything-bridge.js", "extension/dy-demo-bridge/bridge-background.js", "extension/dy-demo-bridge/manifest.json"],
];
const flush = async () => {
  for (let i = 0; i < 40; i++) await Promise.resolve();
};
function event() {
  const listeners = new Set();
  return {
    listeners,
    addListener: (fn) => listeners.add(fn),
    removeListener: (fn) => listeners.delete(fn),
    emit: (...args) => { for (const fn of [...listeners]) fn(...args); },
  };
}

function setup() {
  let now = 0;
  let sequence = 0;
  const timers = new Map();
  const listeners = new Map();
  const posts = [];
  const fetches = [];
  const runtimeMessages = [];
  const portMessages = [];
  const ports = [];
  const warnings = [];
  const clock = (scope) => {
    const schedule = (fn, ms, repeat = false) => {
      const id = ++sequence;
      timers.set(id, { fn, at: now + ms, ms, repeat, scope });
      return id;
    };
    return {
      setTimeout: (fn, ms) => schedule(fn, ms),
      clearTimeout: (id) => timers.delete(id),
      setInterval: (fn, ms) => schedule(fn, ms, true),
      clearInterval: (id) => timers.delete(id),
    };
  };
  const window = {
    location: { origin: "http://localhost:3000" },
    ...clock("tab"),
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
  const shared = {
    window, document: {
      visibilityState: "visible",
      addEventListener: window.addEventListener,
      removeEventListener: window.removeEventListener,
    }, AbortController, DOMException, URL, Error,
    console: { ...console, warn: (...args) => warnings.push(args) },
  };
  const exports = {};
  const health = healthExports.createBridgeHealthStore(() => now);
  vm.runInNewContext(pageCode, {
    ...shared, ...clock("tab"), exports,
    crypto: { randomUUID: () => `request-${++sequence}` },
    require: (name) => {
      if (name === "./bridgeHealth") return { bridgeHealth: health };
      if (name === "./batchResponse") return require("../src/lib/batchResponse.ts");
      assert.equal(name, "./promptMapping");
      return { buildKaUserContent: (question) => question };
    },
  });

  function addLegacy({ targeted = false, delay = 0, transport, id = "old" } = {}) {
    window.addEventListener("message", ({ data }) => {
      if (data.source !== "askanything-page") return;
      const metadata = targeted ? { extensionId: id, protocolVersion: 2 } : {};
      if (data.type === "PING") {
        const respond = () => window.postMessage({
          source: "askanything-extension", requestId: data.requestId, ok: true,
          ...metadata, ...(transport ? { transport } : {}),
        });
        if (delay) clock("worker").setTimeout(respond, delay);
        else respond();
      }
      if ((data.type === "KA_REQUEST" && !targeted) ||
          (data.type === "KA_REQUEST_V2" && targeted && data.extensionId === id)) {
        window.postMessage({
          source: "askanything-extension", requestId: data.requestId, ok: true,
          ...metadata, text: "legacy",
        });
      }
    });
  }

  function addExtension(bridge, id, { vendor = true, content = true, pingDelay = 0 } = {}) {
    const onMessage = event();
    const onConnect = event();
    const sender = { tab: { id: 1, url: window.location.origin }, frameId: 0, documentId: "document" };
    let connectError;
    let nextPortFailure;
    const chrome = { runtime: {
      id, lastError: undefined, onMessage, onConnect,
      getManifest: () => JSON.parse(read(bridge[3])),
      sendMessage(message, callback, originSender = sender) {
        runtimeMessages.push({ id, ...message });
        let answered = false;
        const respond = (response) => {
          if (answered) return;
          answered = true;
          const deliver = () => callback(response);
          if (message.type === "PROXY_PING" && pingDelay) clock("worker").setTimeout(deliver, pingDelay);
          else queueMicrotask(deliver);
        };
        // All listeners receive the message. Only the first sendResponse wins.
        for (const listener of [...onMessage.listeners]) listener(message, originSender, respond);
      },
      connect({ name }, originSender = sender) {
        if (connectError) throw connectError;
        const pair = { closed: false, failPosts: new Set(), failDisconnect: new Set() };
        if (nextPortFailure) pair.failPosts.add(nextPortFailure);
        nextPortFailure = undefined;
        const notify = (endpoint, reason) => queueMicrotask(() => {
          chrome.runtime.lastError = reason ? { message: reason } : undefined;
          try { endpoint.onDisconnect.emit(); }
          finally { chrome.runtime.lastError = undefined; }
        });
        const endpoint = (side) => ({
          name, sender: side === "worker" ? originSender : undefined,
          onMessage: event(), onDisconnect: event(),
          postMessage(message) {
            if (pair.closed || pair.failPosts.has(`${side}:${message.type}`)) {
              throw new Error(`Disconnected port during ${side} ${message.type}`);
            }
            portMessages.push({ id, side, ...message });
            queueMicrotask(() => {
              if (!pair.closed) pair[side === "client" ? "worker" : "client"].onMessage.emit(message);
            });
          },
          disconnect() {
            if (pair.failDisconnect.has(side)) throw new Error(`Invalid ${side} disconnect`);
            if (pair.closed) return;
            pair.closed = true;
            notify(pair[side === "client" ? "worker" : "client"]);
          },
        });
        pair.client = endpoint("client");
        pair.worker = endpoint("worker");
        pair.drop = (reason = "Extension context invalidated.") => {
          if (pair.closed) return;
          pair.closed = true;
          notify(pair.client, reason);
          notify(pair.worker, reason);
        };
        ports.push(pair);
        queueMicrotask(() => onConnect.emit(pair.worker));
        return pair.client;
      },
    } };
    if (vendor) onMessage.addListener((_message, _sender, respond) => {
      // The bundled vendor listener answers unrelated requests asynchronously too.
      Promise.resolve().then(() => respond(undefined));
      return true;
    });
    const fetch = (_url, options) => new Promise((resolve, reject) => {
      fetches.push({
        id, options, reject,
        resolve: (response = {}) => resolve({ ok: true, text: async () => "answer", ...response }),
      });
      options.signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
    });
    vm.runInNewContext(read(bridge[2]), { ...shared, ...clock("worker"), chrome, fetch });
    if (content) vm.runInNewContext(read(bridge[1]), { ...shared, ...clock("tab"), chrome });
    return {
      sender, onMessage, onConnect,
      connect: (originSender = sender) => chrome.runtime.connect({ name: "askanything-ka" }, originSender),
      failConnect: () => { connectError = new Error("Extension context invalidated."); },
      failNextPortPost: (message) => { nextPortFailure = message; },
      sendMessage: (...args) => chrome.runtime.sendMessage(...args),
    };
  }

  async function tick(ms, { workerOnly = false, tabOnly = false } = {}) {
    const end = now + ms;
    while (true) {
      const entry = [...timers].filter(([, timer]) =>
        timer.at <= end && (!workerOnly || timer.scope === "worker") && (!tabOnly || timer.scope === "tab"))
        .sort((a, b) => a[1].at - b[1].at)[0];
      if (!entry) break;
      const [id, timer] = entry;
      now = Math.max(now, timer.at);
      if (timer.repeat) timer.at = now + timer.ms;
      else timers.delete(id);
      timer.fn();
      await flush();
    }
    now = end;
    await flush();
  }
  function clean(baseline = listeners.get("message")?.size || 0) {
    assert.equal(timers.size, 0, "all request timers must be released");
    assert.equal(listeners.get("message")?.size || 0, baseline);
    for (const pair of ports) {
      assert.equal(pair.closed, true, "request ports must close");
      for (const side of ["client", "worker"]) {
        assert.equal(pair[side].onMessage.listeners.size, 0, `${side} message listener cleanup`);
        assert.equal(pair[side].onDisconnect.listeners.size, 0, `${side} disconnect listener cleanup`);
      }
    }
  }
  return {
    exports, health, window, document: shared.document, posts, fetches, timers, listeners, runtimeMessages, portMessages, ports, warnings,
    addExtension, addLegacy, tick, clean,
  };
}

function fixture(index) {
  const state = setup();
  state.addLegacy();
  state.addLegacy({ targeted: true });
  const worker = state.addExtension(bridges[index], "selected");
  state.addExtension(bridges[1 - index], "other");
  const baseline = state.listeners.get("message").size;
  return {
    ...state, worker,
    ask: (signal, onBridgeSelected) => state.exports.askKaViaExtension("Question?", { mode: "loopio", signal, onBridgeSelected }),
    request: () => state.posts.find((message) => message.type === "KA_REQUEST_V2"),
    clean: () => state.clean(baseline),
  };
}

test("health: extension recovery clears only extension errors and never restores old KA confirmation", () => {
  const store = healthExports.createBridgeHealthStore();
  const ticket = store.beginRequest();
  store.selected(ticket, { extensionId: "one" });
  store.kaResponded(ticket);
  store.succeed(ticket);
  store.completeProbe(store.beginProbe(), null, "Extension reloading");
  store.completeProbe(store.beginProbe(), { extensionId: "one" });
  assert.equal(store.getSnapshot().extension, "detected");
  assert.equal(store.getSnapshot().error, null);
  assert.equal(store.getSnapshot().phase, "untested");
  assert.equal(healthExports.bridgeHealthSummary(store.getSnapshot(), Date.now()).tone, "neutral");
  for (const stage of ["ka", "app", "answer"]) {
    const request = store.beginRequest();
    store.fail(request, stage, `${stage} failed`);
    store.completeProbe(store.beginProbe(), null, "Reloading");
    store.completeProbe(store.beginProbe(), { extensionId: "one" });
    assert.equal(store.getSnapshot().extension, "detected");
    assert.equal(store.getSnapshot().errorStage, stage);
    assert.equal(store.getSnapshot().error, `${stage} failed`);
  }
});

test("monitor: detects extension loaded after failed PING, without a KA request or focus change", async () => {
  const state = setup();
  state.window.location.hostname = "hosted.example";
  const stop = state.exports.watchExtensionBridge();
  const stopSecond = state.exports.watchExtensionBridge();
  assert.equal(state.posts.length, 1, "consumers share a single monitor");
  await state.tick(5000);
  assert.equal(state.health.getSnapshot().extension, "missing");
  state.addExtension(bridges[0], "reloaded");
  await state.tick(5000);
  assert.equal(state.health.getSnapshot().extension, "detected");
  assert.equal(state.health.getSnapshot().phase, "untested");
  assert.equal(state.health.getSnapshot().error, null);
  assert.equal(state.fetches.length, 0, "polling must never call KA");
  stop();
  stop();
  await state.tick(5000);
  const count = state.posts.length;
  stopSecond();
  await state.tick(10000);
  assert.equal(state.posts.length, count);
  state.clean();
});

test("monitor: hidden views and active requests pause PING, unmount cancels pending discovery", async () => {
  const state = setup();
  state.window.location.hostname = "hosted.example";
  state.document.visibilityState = "hidden";
  const stop = state.exports.watchExtensionBridge();
  await state.tick(10000);
  assert.equal(state.posts.length, 0);
  state.document.visibilityState = "visible";
  await state.tick(5000);
  assert.equal(state.posts.length, 1);
  const ticket = state.health.beginRequest();
  await flush();
  await state.tick(10000);
  assert.equal(state.posts.length, 1);
  assert.equal(state.health.getSnapshot().phase, "discovering");
  state.health.cancel(ticket);
  await state.tick(5000);
  assert.equal(state.posts.length, 2);
  stop();
  await flush();
  assert.equal(state.health.getSnapshot().phase, "cancelled");
  state.clean();
});

test("monitor: localhost does not probe the unused extension", async () => {
  const state = setup();
  state.window.location.hostname = "localhost";
  const stop = state.exports.watchExtensionBridge();
  await state.tick(10000);
  assert.equal(state.posts.length, 0);
  stop();
  state.clean();
});

test("health: PING alone never confirms KA, and success expires without additional requests", () => {
  let now = 1000;
  const store = healthExports.createBridgeHealthStore(() => now);
  const summary = () => healthExports.bridgeHealthSummary(store.getSnapshot(), now);
  store.completeProbe(store.beginProbe(), { extensionId: "one", transport: "port" });
  // A working extension with no KA request yet must be neutral, never green and
  // never alarming.
  assert.equal(summary().tone, "neutral");
  assert.match(summary().label, /not tested yet/);
  assert.equal(store.getSnapshot().lastSuccessAt, null);
  const ticket = store.beginRequest();
  assert.match(summary().label, /Checking/);
  store.selected(ticket, { extensionId: "one", transport: "port" });
  assert.match(summary().label, /Waiting/);
  now += 7000;
  store.kaResponded(ticket);
  assert.equal(summary().tone, "info", "KA success alone must still wait for app processing");
  store.succeed(ticket);
  assert.equal(summary().tone, "success");
  assert.equal(store.getSnapshot().lastDurationMs, 7000);
  now += healthExports.BRIDGE_CONFIRMATION_TTL_MS;
  assert.equal(summary().tone, "neutral");
  assert.match(summary().label, /confirmed earlier/);
});

test("health: idle states are never green and never alarming", () => {
  const neutral = [
    { extension: "detected" },
    { extension: "detected", phase: "ready", lastSuccessAt: 1 },
  ];
  for (const patch of neutral) {
    const summary = healthExports.bridgeHealthSummary(
      { ...healthExports.INITIAL_BRIDGE_HEALTH, ...patch }, 10 ** 9,
    );
    assert.equal(summary.tone, "neutral", summary.label);
    assert.doesNotMatch(summary.label, /fail|error|not detected/i);
  }
  const missing = healthExports.bridgeHealthSummary(
    { ...healthExports.INITIAL_BRIDGE_HEALTH, extension: "missing" }, 10 ** 9,
  );
  assert.equal(missing.tone, "error");
});

test("health: newer failures survive late results and successful PINGs", () => {
  const store = healthExports.createBridgeHealthStore();
  const old = store.beginRequest();
  const oldProbe = store.beginProbe();
  const current = store.beginRequest();
  store.selected(current, { extensionId: "one", transport: "port" });
  store.fail(current, "ka", "Channel closed");
  store.kaResponded(old);
  store.succeed(old);
  store.completeProbe(oldProbe, { extensionId: "outdated" });
  assert.equal(store.getSnapshot().identity.extensionId, "one");
  store.completeProbe(store.beginProbe(), { extensionId: "one", transport: "port" });
  assert.equal(store.getSnapshot().phase, "error");
  assert.equal(store.getSnapshot().error, "Channel closed");
  const firstProbe = store.beginProbe();
  const secondProbe = store.beginProbe();
  store.completeProbe(secondProbe, null, "Extension removed");
  store.completeProbe(firstProbe, { extensionId: "old" });
  assert.equal(store.getSnapshot().extension, "missing");
});

test("health: a failure after success immediately removes green; quality/app failures retain KA evidence", () => {
  for (const stage of ["extension", "ka", "app", "answer"]) {
    const store = healthExports.createBridgeHealthStore();
    let ticket = store.beginRequest();
    store.selected(ticket, { extensionId: "one" });
    store.kaResponded(ticket);
    store.succeed(ticket);
    const confirmed = store.getSnapshot().lastSuccessAt;
    ticket = store.beginRequest();
    store.selected(ticket, { extensionId: "one" });
    if (stage === "app" || stage === "answer") store.kaResponded(ticket);
    store.fail(ticket, stage, "Failed");
    assert.equal(healthExports.bridgeHealthSummary(store.getSnapshot(), Date.now()).tone, "error");
    assert.equal(store.getSnapshot().lastSuccessAt, confirmed, "historical success remains visibly historical");
    assert.equal(store.getSnapshot().errorStage, stage);
    assert.equal(store.getSnapshot().kaRespondedAt !== null, stage === "app" || stage === "answer");
  }
});

test("health: cancellation, offline/reconnect and changed extension never restore an old green result", () => {
  const store = healthExports.createBridgeHealthStore();
  const succeed = () => {
    const ticket = store.beginRequest();
    store.selected(ticket, { extensionId: "one", transport: "port" });
    store.kaResponded(ticket);
    store.succeed(ticket);
  };
  succeed();
  store.network(false);
  store.network(true);
  assert.equal(store.getSnapshot().phase, "error");
  succeed();
  store.completeProbe(store.beginProbe(), { extensionId: "two", transport: "port" });
  assert.equal(store.getSnapshot().phase, "untested");
  const ticket = store.beginRequest();
  store.cancel(ticket);
  store.kaResponded(ticket);
  store.succeed(ticket);
  assert.equal(store.getSnapshot().phase, "cancelled");
  assert.notEqual(healthExports.bridgeHealthSummary(store.getSnapshot(), Date.now()).tone, "success");
  const timeout = store.beginRequest();
  store.cancel(timeout, { name: "TimeoutError", message: "Deadline exceeded" });
  assert.equal(store.getSnapshot().phase, "error");
  assert.match(store.getSnapshot().error, /Deadline/);
});

test("health: successful PING followed by a real transport failure stays failed after another PING", async () => {
  const state = fixture(0);
  const detection = state.exports.isExtensionBridgeAvailable();
  await flush();
  assert.equal(await detection, true);
  assert.equal(state.health.getSnapshot().phase, "untested");
  assert.equal(state.fetches.length, 0);
  const answer = state.ask();
  const rejected = assert.rejects(answer, /Could not reach/);
  await flush();
  state.fetches[0].reject(new Error("network unavailable"));
  await rejected;
  assert.equal(state.health.getSnapshot().phase, "error");
  const ping = state.exports.isExtensionBridgeAvailable();
  await flush();
  assert.equal(await ping, true);
  assert.equal(state.health.getSnapshot().phase, "error");
  assert.equal(state.fetches.length, 1);
  state.clean();
});

test("health: empty and HTML upstream replies fail instead of confirming KA", async () => {
  for (const text of ["", "<!DOCTYPE html><html>Login required</html>"]) {
    const state = fixture(0);
    const answer = state.ask();
    const rejected = assert.rejects(answer, /empty|HTML/);
    await flush();
    state.fetches[0].resolve({ text: async () => text });
    await rejected;
    assert.equal(state.health.getSnapshot().phase, "error");
    assert.equal(state.health.getSnapshot().errorStage, text ? "ka" : "answer");
    assert.equal(state.health.getSnapshot().kaRespondedAt !== null, !text);
    await flush();
    state.clean();
  }
});

test("Bridge panel renders truthful local, detected, failed, expired and confirmed states", () => {
  const React = require("react");
  const { renderToStaticMarkup } = require("react-dom/server");
  const code = ts.transpileModule(read("src/components/BridgeStatus.tsx"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const render = (required, patch) => {
    const state = { ...healthExports.INITIAL_BRIDGE_HEALTH, ...patch };
    const exports = {};
    vm.runInNewContext(code, {
      exports,
      require: (name) => {
        if (name === "react") return { useEffect: () => {}, useState: () => [required, () => {}] };
        if (name === "@/lib/useBridgeHealth") return {
          useBridgeHealth: () => ({ state, now: 100000, summary: healthExports.bridgeHealthSummary(state, 100000) }),
        };
        if (name === "@/lib/bridgeHealth") return healthExports;
        if (name === "@/lib/extensionBridge") return {};
        return require(name);
      },
    });
    return renderToStaticMarkup(React.createElement(exports.default, { busy: false, testing: false, onTest: () => {}, onStop: () => {} }));
  };
  const local = render(false, {});
  assert.match(local, /Direct connection \(localhost\)/);
  assert.doesNotMatch(local, /<button|text-green-700/);
  const ping = render(true, { extension: "detected" });
  assert.match(ping, /Extension ready · KA not tested yet/);
  assert.doesNotMatch(ping, /text-green-700/);
  const failed = render(true, { phase: "error", errorStage: "answer", error: "No answer", kaRespondedAt: 90000 });
  assert.match(failed, /not a bridge disconnection/);
  assert.match(failed, /role="alert"/);
  assert.doesNotMatch(failed, /text-green-700/);
  assert.doesNotMatch(render(true, { phase: "ready", lastSuccessAt: 1 }), /text-green-700/);
  assert.match(render(true, { phase: "ready", lastSuccessAt: 99999 }), /Last request successful/);

  // A working-but-legacy channel must never be styled as a failure next to a
  // successful result, and must name the real cause.
  const success = { phase: "ready", lastSuccessAt: 99999, extension: "detected" };
  const port = render(true, { ...success, identity: { extensionId: "abc", extensionVersion: "1.2.0", transport: "port" } });
  assert.doesNotMatch(port, /legacy|chrome:\/\/extensions/i);
  const unidentified = render(true, { ...success, identity: {} });
  assert.match(unidentified, /older build that does not identify itself/);
  assert.match(unidentified, /chrome:\/\/extensions/);
  assert.match(unidentified, /Last request successful/);
  assert.doesNotMatch(unidentified, /text-amber-700|role="alert"/);
  const legacy = render(true, { ...success, identity: { extensionId: "abc", extensionVersion: "1.0.0" } });
  assert.match(legacy, /legacy callback channel/);
  assert.doesNotMatch(legacy, /does not identify itself/);
  assert.doesNotMatch(legacy, /text-amber-700|role="alert"/);
});

for (const [index, [name]] of bridges.entries()) {
  test(`${name}: port wins upgrade discovery and vendor competition; worker heartbeat survives throttled tab timers`, async () => {
    const state = fixture(index);
    let selected;
    const result = state.ask(undefined, (bridge) => { selected = bridge; });
    await flush();
    assert.equal(selected.extensionId, "selected");
    assert.equal(selected.transport, "port");
    assert.equal(selected.extensionVersion, JSON.parse(read(bridges[index][3])).version);
    assert.equal(state.fetches.length, 1);
    assert.equal(state.fetches[0].id, "selected");
    assert.equal(state.posts.filter((message) => /KA_REQUEST/.test(message.type)).length, 1);
    assert.equal(state.runtimeMessages.filter((message) => message.type === "PROXY_KA_REQUEST").length, 0);
    await state.tick(80000, { workerOnly: true });
    assert.equal(state.fetches.length, 1);
    assert.equal(state.portMessages.filter((message) => message.type === "HEARTBEAT").length, 4);
    assert.equal(state.portMessages.filter((message) => message.type === "HEARTBEAT_ACK").length, 4);
    state.fetches[0].resolve();
    assert.equal(await result, "answer");
    await flush();
    state.clean();
  });

  test(`${name}: harness reproduces vendor's first-response race on legacy sendMessage`, async () => {
    const state = setup();
    const worker = state.addExtension(bridges[index], "selected", { content: false });
    assert.equal(worker.onMessage.listeners.size, 2);
    let called = false;
    worker.sendMessage({ type: "PROXY_KA_REQUEST", requestId: "old", messages: [{ role: "user", content: "q" }] }, (response) => {
      called = true;
      assert.equal(response, undefined);
    });
    await flush();
    assert.equal(called, true);
    assert.equal(state.fetches.length, 1, "the losing KA listener still started work");
    worker.sendMessage({ type: "PROXY_KA_CANCEL", requestId: "old" }, () => {});
    await flush();
    assert.equal(state.fetches[0].options.signal.aborted, true);
    state.clean();
  });

  test(`${name}: legacy onMessage still works without a competing listener`, async () => {
    const state = setup();
    const worker = state.addExtension(bridges[index], "selected", { content: false, vendor: false });
    let response;
    worker.sendMessage({ type: "PROXY_KA_REQUEST", messages: [{ role: "user", content: "q" }] }, (value) => { response = value; });
    await flush();
    state.fetches[0].resolve();
    await flush();
    assert.equal(response.text, "answer");
    state.clean();
  });

  test(`${name}: legacy response delivery exceptions are logged, not unhandled rejections`, async () => {
    const state = setup();
    const worker = state.addExtension(bridges[index], "selected", { content: false, vendor: false });
    worker.onMessage.emit(
      { type: "PROXY_KA_REQUEST", messages: [{ role: "user", content: "q" }] },
      worker.sender, () => { throw new Error("The legacy channel closed."); },
    );
    state.fetches[0].resolve();
    await flush();
    assert.ok(state.warnings.some(([message]) => /Legacy KA response channel closed/.test(message)));
    state.clean();
  });

  test(`${name}: abort disconnects and cancels only this request`, async () => {
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

  test(`${name}: worker deadline cancels at 180 seconds with tab timers suspended`, async () => {
    const state = fixture(index);
    const result = state.ask();
    await flush();
    const rejected = assert.rejects(result, /180 seconds/);
    await state.tick(180000, { workerOnly: true });
    await rejected;
    assert.equal(state.fetches.length, 1);
    assert.equal(state.fetches[0].options.signal.aborted, true);
    state.clean();
  });

  test(`${name}: page deadline closes the port at 190 seconds if the worker stops responding`, async () => {
    const state = fixture(index);
    const result = state.ask();
    await flush();
    const rejected = assert.rejects(result, /190 seconds/);
    await state.tick(190000, { tabOnly: true });
    await rejected;
    assert.equal(state.fetches[0].options.signal.aborted, true);
    assert.equal(state.fetches.length, 1);
    state.clean();
  });

  test(`${name}: network failure clears all request resources without retry`, async () => {
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
    assert.equal(state.posts.length, 0);
    assert.equal(state.ports.length, 0);
    state.clean();
  });

  test(`${name}: another tab cannot cancel through the legacy control path`, async () => {
    const state = fixture(index);
    const result = state.ask();
    await flush();
    state.worker.sendMessage(
      { type: "PROXY_KA_CANCEL", requestId: state.request().requestId }, () => {},
      { ...state.worker.sender, tab: { ...state.worker.sender.tab, id: 2 } },
    );
    await flush();
    assert.equal(state.fetches[0].options.signal.aborted, false);
    state.fetches[0].resolve();
    assert.equal(await result, "answer");
    await flush();
    state.clean();
  });

  test(`${name}: duplicate port START cannot resubmit or abort the original port's controller`, async () => {
    const state = fixture(index);
    const result = state.ask();
    await flush();
    const message = { type: "START", requestId: state.request().requestId, messages: [{ role: "user", content: "q" }] };
    state.ports[0].client.postMessage(message);
    const duplicate = state.worker.connect();
    duplicate.postMessage(message);
    await flush();
    assert.equal(state.fetches.length, 1);
    duplicate.disconnect();
    await flush();
    assert.equal(state.fetches[0].options.signal.aborted, false);
    state.fetches[0].resolve();
    assert.equal(await result, "answer");
    await flush();
    state.clean();
  });

  test(`${name}: stale request IDs on the port cannot settle or heartbeat the request`, async () => {
    const state = fixture(index);
    const result = state.ask();
    await flush();
    state.ports[0].worker.postMessage({ type: "RESULT", requestId: "wrong", ok: true, text: "wrong" });
    state.ports[0].worker.postMessage({ type: "HEARTBEAT", requestId: "wrong" });
    await flush();
    assert.equal(state.portMessages.filter((message) => message.type === "HEARTBEAT_ACK").length, 0);
    state.fetches[0].resolve();
    assert.equal(await result, "answer");
    await flush();
    state.clean();
  });

  for (const failure of ["disconnect", "client:HEARTBEAT_ACK", "worker:HEARTBEAT", "worker:RESULT"]) {
    test(`${name}: ${failure} failure cancels, rejects and never resubmits`, async () => {
      const state = fixture(index);
      const result = state.ask();
      await flush();
      const rejected = assert.rejects(result, /bridge (disconnected|heartbeat failed)/);
      if (failure === "disconnect") state.ports[0].drop();
      else {
        state.ports[0].failPosts.add(failure);
        if (failure === "worker:RESULT") state.fetches[0].resolve();
        else await state.tick(20000, { workerOnly: true });
      }
      await rejected;
      await flush();
      assert.equal(state.fetches[0].options.signal.aborted, true);
      assert.equal(state.fetches.length, 1);
      state.clean();
    });
  }

  test(`${name}: connect failure is actionable and starts no KA fetch`, async () => {
    const state = fixture(index);
    state.worker.failConnect();
    await assert.rejects(state.ask(), /Reload the extension and this tab/);
    await flush();
    assert.equal(state.fetches.length, 0);
    state.clean();
  });

  test(`${name}: START send failure cleans the unopened request`, async () => {
    const state = fixture(index);
    state.worker.failNextPortPost("client:START");
    await assert.rejects(state.ask(), /Disconnected port during client START/);
    await flush();
    assert.equal(state.fetches.length, 0);
    state.clean();
  });

  test(`${name}: disconnect exception is reported and falls back to cancellation without generation`, async () => {
    const state = fixture(index);
    const controller = new AbortController();
    const result = state.ask(controller.signal);
    await flush();
    state.ports[0].failDisconnect.add("client");
    const rejected = assert.rejects(result, { name: "AbortError" });
    controller.abort();
    await rejected;
    await flush();
    assert.ok(state.warnings.some(([message]) => /Could not disconnect/.test(message)));
    assert.ok(state.runtimeMessages.some((message) => message.type === "PROXY_KA_CANCEL"));
    assert.equal(state.fetches.length, 1);
    assert.equal(state.fetches[0].options.signal.aborted, true);
    await state.tick(10000, { workerOnly: true });
    state.clean();
  });

  test(`${name}: pagehide disconnects, stops heartbeat and aborts the worker`, async () => {
    const state = fixture(index);
    const controller = new AbortController();
    const result = state.ask(controller.signal);
    await flush();
    for (const listener of state.listeners.get("pagehide")) listener();
    await flush();
    assert.equal(state.fetches[0].options.signal.aborted, true);
    const rejected = assert.rejects(result, { name: "AbortError" });
    controller.abort();
    await rejected;
    await flush();
    state.clean();
  });

  test(`${name}: unused and untrusted ports close without work`, async () => {
    const state = setup();
    const worker = state.addExtension(bridges[index], "selected", { content: false });
    worker.connect({ tab: { id: 2, url: "https://untrusted.example" } });
    worker.connect();
    await flush();
    await state.tick(5000);
    assert.equal(state.fetches.length, 0);
    state.clean();
  });
}

test("unmodified legacy page bridge responds after the 300ms fallback", async () => {
  const state = setup();
  state.addLegacy();
  const baseline = state.listeners.get("message").size;
  const result = state.exports.askKaViaExtension("Question?", { mode: "loopio" });
  await flush();
  await state.tick(299);
  assert.equal(state.posts.filter((message) => message.type === "KA_REQUEST").length, 0);
  await state.tick(1);
  assert.equal(await result, "legacy");
  assert.equal(state.posts.filter((message) => message.type === "KA_REQUEST").length, 1);
  state.clean(baseline);
});

test("a port upgrade arriving inside the fallback window is preferred over the old targeted bridge", async () => {
  const state = setup();
  state.addLegacy({ targeted: true });
  state.addExtension(bridges[1], "upgraded", { pingDelay: 250 });
  const result = state.exports.askKaViaExtension("q", { mode: "loopio" });
  await flush();
  await state.tick(250);
  assert.equal(state.fetches.length, 1);
  assert.equal(state.fetches[0].id, "upgraded");
  state.fetches[0].resolve();
  assert.equal(await result, "answer");
  await flush();
  state.clean();
});

test("old targeted bridge still works without a port upgrade", async () => {
  const state = setup();
  state.addLegacy({ targeted: true });
  const result = state.exports.askKaViaExtension("q", { mode: "loopio" });
  await flush();
  await state.tick(300);
  assert.equal(await result, "legacy");
  assert.equal(state.posts.filter((message) => message.type === "KA_REQUEST_V2").length, 1);
  state.clean();
});

test("page rejects wrong extension identity and cancels at 190 seconds without resubmitting", async () => {
  const state = setup();
  state.window.addEventListener("message", ({ data }) => {
    if (data.type === "PING") state.window.postMessage({
      source: "askanything-extension", requestId: data.requestId,
      ok: true, extensionId: "selected", protocolVersion: 2, transport: "port",
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
  state.clean(baseline);
});

test("both manifests advertise the intended port transport release and supported Chrome lifecycle", () => {
  for (const [index, bridge] of bridges.entries()) {
    const manifest = JSON.parse(read(bridge[3]));
    assert.equal(manifest.manifest_version, 3);
    assert.equal(manifest.version, ["1.2.0", "2.5.4"][index]);
    assert.equal(manifest.minimum_chrome_version, "114");
    assert.equal(manifest.content_scripts.filter((script) =>
      script.js.includes(index ? "content-scripts/askanything-bridge.js" : "content.js")).length, 1);
  }
});
