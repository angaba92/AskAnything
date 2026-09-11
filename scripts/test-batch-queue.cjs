const assert = require("node:assert/strict");
const { test } = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");
const XLSX = require("xlsx");

require.extensions[".ts"] = (module, filename) => module._compile(
  ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, filename,
);

function harness({ hostname = "demo.example", apiStatus = 200 } = {}) {
  const health = require("../src/lib/bridgeHealth.ts").createBridgeHealthStore();
  const slots = [];
  let cursor = 0;
  const requests = [];
  const queued = [];
  let exported;
  const hooks = {
    createContext: () => ({ Provider: "provider" }),
    useContext: () => null,
    useCallback: (callback) => callback,
    useRef: (initial) => {
      const index = cursor++;
      return slots[index] ??= { current: initial };
    },
    useState: (initial) => {
      const index = cursor++;
      if (!(index in slots)) slots[index] = initial;
      return [slots[index], (next) => { slots[index] = typeof next === "function" ? next(slots[index]) : next; }];
    },
  };
  const bridge = {
    isExtensionBridgeAvailable: async () => {
      health.completeProbe(health.beginProbe(), { extensionId: "test", transport: "port" });
      return true;
    },
    askKaViaExtension: (question, options) => new Promise((resolve, reject) => {
      const ticket = health.beginRequest();
      options.onRequestStarted?.(ticket);
      health.selected(ticket, { extensionId: "test", transport: "port" });
      const fail = (error) => { health.fail(ticket, "ka", error.message); reject(error); };
      const job = { question, options, resolve: (answer) => { health.kaResponded(ticket); resolve(answer); }, reject: fail };
      requests.push(job);
      queued.push(job);
      options.signal?.addEventListener("abort", () => reject(new DOMException("Cancelled", "AbortError")), { once: true });
    }),
  };
  const exports = {};
  const filename = path.resolve("src/components/BatchProvider.tsx");
  const compiled = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText;
  const localRequire = (name) => {
    if (name === "react") return hooks;
    if (name === "react/jsx-runtime") return { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) };
    if (name === "next/navigation") return { usePathname: () => "/batch" };
    if (name === "next/link") return () => null;
    if (name === "@/lib/extensionBridge") return bridge;
    if (name === "@/lib/bridgeHealth") return { bridgeHealth: health };
    if (name === "xlsx") return { ...XLSX, writeFile: (wb) => { exported = wb; } };
    if (name.startsWith("@/")) return require(path.resolve("src", name.slice(2)) + ".ts");
    return require(name);
  };
  class Reader {
    readAsArrayBuffer(buffer) { this.onload({ target: { result: buffer } }); }
  }
  vm.runInNewContext(compiled, {
    exports, require: localRequire, console, FileReader: Reader,
    window: { location: { hostname } },
    AbortController, DOMException, setTimeout, clearTimeout,
    setInterval: (callback) => setInterval(callback, 1), clearInterval,
    fetch: async (_url, init) => {
      if (init.signal?.aborted) throw new DOMException("Cancelled", "AbortError");
      const body = JSON.parse(init.body);
      if (apiStatus !== 200) return Response.json({ error: "App failure" }, { status: apiStatus });
      if (body.localKaResponse === "EMPTY") return Response.json({
        error: "No substantive answer", reviewReason: "Latency unsupported",
      }, { status: 422 });
      return Response.json({
        answer: body.localKaResponse, expert: "knowledge_assistant", tools: "",
        reviewRequired: Boolean(body.context), reviewReason: body.context ? "Updated review" : "",
      });
    },
  }, { filename });
  const render = () => { cursor = 0; return exports.default({ children: null }).props.value; };
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
    ["Question", "Answer", "Needs Review"],
    ["What is question one?", "", ""],
    ["What is question two?", "Existing answer.", "Old review"],
    ["What is question three?", "", ""],
  ]), "Questions");
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([["Keep this sheet"]]), "Other");
  const file = XLSX.write(workbook, { type: "array", bookType: "xlsx" });
  file.name = "questionnaire.xlsx";
  render().loadFile(file);
  render().applyMapping();
  render();
  const flush = () => new Promise((resolve) => setImmediate(resolve));
  const waitFor = async (predicate) => {
    for (let i = 0; i < 1000; i++) {
      if (predicate()) return;
      await new Promise((resolve) => setTimeout(resolve, 1));
    }
    throw new Error("Scheduler did not reach expected state.");
  };
  return { render, health, requests, queued, flush, waitFor, exported: () => exported };
}

test("FIFO Redo priority, duplicate prevention, review replacement and workbook export", async () => {
  const h = harness();
  const run = h.render().run();
  await h.waitFor(() => h.queued.length === 1);
  await h.render().redoRow(1, "First owner notes");
  await h.render().redoRow(1, "Duplicate must not run");
  h.queued.shift().resolve("A substantive first answer.");
  await h.waitFor(() => h.queued.length === 1);
  assert.match(h.queued[0].options.context, /First owner notes/);
  h.queued.shift().resolve("A revised second answer.");
  await h.waitFor(() => h.queued.length === 1);
  assert.match(h.queued[0].question, /three/);
  h.queued.shift().resolve("A substantive third answer.");
  await run;
  const state = h.render();
  assert.equal(h.requests.length, 3);
  assert.equal(state.rows[1].review, "Updated review");
  assert.equal(state.rows[1].answer, "A revised second answer.");
  assert.equal(state.rows[1].reviewApproved, false);
  assert.equal(state.running, false);
  assert.equal(h.health.getSnapshot().phase, "ready");
  state.download();
  assert.equal(h.exported().Sheets.Questions.B3.v, "A revised second answer.");
  assert.equal(h.exported().Sheets.Questions.C3.v, "Updated review");
  assert.equal(h.exported().Sheets.Other.A1.v, "Keep this sheet");
});

test("Stop aborts request, clears queued Redos and preserves completed rows", async () => {
  const h = harness();
  const run = h.render().run();
  await h.waitFor(() => h.queued.length === 1);
  await h.render().redoRow(1, "Queued notes");
  h.render().stop();
  await run;
  const state = h.render();
  assert.equal(h.requests.length, 1);
  assert.equal(state.queuedRedoRows.length, 0);
  assert.equal(state.rows[0].status, "pending");
  assert.equal(state.rows[1].answer, "Existing answer.");
  assert.equal(state.running, false);
  assert.equal(h.health.getSnapshot().phase, "cancelled");
});

test("standalone Redos serialize and block Start and remapping synchronously", async () => {
  const h = harness();
  const state = h.render();
  const redo = state.redoRow(1, "Owner notes");
  await state.run();
  state.applyMapping();
  await h.waitFor(() => h.queued.length === 1);
  await h.render().redoRow(0, "Second owner notes");
  h.queued.shift().resolve("A revised second answer.");
  await h.waitFor(() => h.queued.length === 1);
  h.queued.shift().resolve("A revised first answer.");
  await redo;
  assert.equal(h.requests.length, 2);
  assert.equal(h.render().rows[0].answer, "A revised first answer.");
  assert.equal(h.render().rows[1].answer, "A revised second answer.");
});

test("quality failure advances without regenerating; Redo can repair failed rows", async () => {
  const h = harness();
  const run = h.render().run();
  await h.waitFor(() => h.queued.length === 1);
  h.queued.shift().resolve("EMPTY");
  await h.waitFor(() => h.queued.length === 1);
  assert.match(h.queued[0].question, /three/);
  h.queued.shift().resolve("A substantive third answer.");
  await run;
  assert.equal(h.render().rows[0].status, "error");
  assert.equal(h.render().rows[0].answer, "");
  assert.match(h.render().rows[0].review, /Latency unsupported/);
  const redo = h.render().redoRow(0, "Additional evidence");
  await h.waitFor(() => h.queued.length === 1);
  h.queued.shift().resolve("A repaired first answer.");
  await redo;
  assert.equal(h.render().rows[0].status, "done");
});

test("bridge check makes one KA request and includes application processing", async () => {
  const h = harness();
  const checking = h.render().testBridge();
  await h.waitFor(() => h.queued.length === 1);
  await h.render().run();
  assert.match(h.render().error, /active request/);
  h.queued.shift().resolve("Connection check successful.");
  await checking;
  assert.equal(h.requests.length, 1);
  assert.equal(h.health.getSnapshot().phase, "ready");
  assert.match(h.render().bridgeTest, /KA and app responded/);
  assert.equal(h.render().testingBridge, false);
});

test("bridge checks expose application authentication errors instead of a false success", async () => {
  const h = harness({ apiStatus: 401 });
  const checking = h.render().testBridge();
  await h.waitFor(() => h.queued.length === 1);
  h.queued.shift().resolve("Connection check successful.");
  await checking;
  assert.equal(h.health.getSnapshot().phase, "error");
  assert.equal(h.health.getSnapshot().errorStage, "app");
  assert.notEqual(h.health.getSnapshot().kaRespondedAt, null);
  assert.equal(h.health.getSnapshot().lastSuccessAt, null);
  assert.match(h.render().bridgeTest, /authentication/);
});

test("ordinary batch API failure updates bridge health and pauses without regenerating", async () => {
  const h = harness({ apiStatus: 503 });
  const run = h.render().run();
  await h.waitFor(() => h.queued.length === 1);
  h.queued.shift().resolve("A substantive first answer.");
  await run;
  assert.equal(h.requests.length, 1);
  assert.equal(h.health.getSnapshot().phase, "error");
  assert.equal(h.health.getSnapshot().errorStage, "app");
});

test("Redo quality failure is not a transport failure and preserves the previous answer", async () => {
  const h = harness();
  const redo = h.render().redoRow(1, "Owner notes");
  await h.waitFor(() => h.queued.length === 1);
  h.queued.shift().resolve("EMPTY");
  await redo;
  assert.equal(h.health.getSnapshot().phase, "error");
  assert.equal(h.health.getSnapshot().errorStage, "answer");
  assert.notEqual(h.health.getSnapshot().kaRespondedAt, null);
  assert.equal(h.render().rows[1].answer, "Existing answer.");
});

test("cancelled bridge check releases operation lock and never reports success", async () => {
  const h = harness();
  const checking = h.render().testBridge();
  await h.waitFor(() => h.queued.length === 1);
  h.render().stop();
  await checking;
  assert.equal(h.health.getSnapshot().phase, "cancelled");
  assert.equal(h.health.getSnapshot().lastSuccessAt, null);
  assert.equal(h.render().testingBridge, false);
});

test("localhost never pretends a skipped bridge test succeeded", async () => {
  const h = harness({ hostname: "localhost" });
  await h.render().testBridge();
  assert.equal(h.requests.length, 0);
  assert.equal(h.health.getSnapshot().phase, "untested");
  assert.match(h.render().bridgeTest, /not used here/);
});

test("empty raw KA answer advances as a quality failure instead of generating again", async () => {
  const h = harness();
  const { BatchRequestError } = require("../src/lib/batchResponse.ts");
  const run = h.render().run();
  await h.waitFor(() => h.queued.length === 1);
  h.queued.shift().reject(new BatchRequestError("Knowledge Assistant returned an empty answer.", 422));
  await h.waitFor(() => h.queued.length === 1);
  assert.match(h.queued[0].question, /three/);
  h.queued.shift().resolve("A substantive third answer.");
  await run;
  assert.equal(h.requests.length, 2);
  assert.equal(h.render().rows[0].status, "error");
});
