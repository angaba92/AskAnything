const assert = require("node:assert/strict");
const { test } = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");

test("back/forward refreshes the active route once without losing provider state", () => {
  const listeners = new Map();
  let effect;
  let refreshes = 0;
  let nextFrame = 0;
  const frames = new Map();
  const window = {
    addEventListener: (type, listener) => listeners.set(type, listener),
    removeEventListener: (type, listener) => {
      if (listeners.get(type) === listener) listeners.delete(type);
    },
    requestAnimationFrame: (callback) => {
      const id = ++nextFrame;
      frames.set(id, callback);
      return id;
    },
    cancelAnimationFrame: (id) => frames.delete(id),
  };
  const exports = {};
  const filename = path.resolve("src/components/NavigationRecovery.tsx");
  const compiled = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
      esModuleInterop: true,
    },
  }).outputText;
  vm.runInNewContext(compiled, {
    exports,
    window,
    require: (name) => {
      if (name === "react") return { useEffect: (callback) => { effect = callback; } };
      if (name === "next/navigation") return { useRouter: () => ({ refresh: () => { refreshes++; } }) };
      if (name === "react/jsx-runtime") return {};
      return require(name);
    },
  }, { filename });

  assert.equal(exports.default(), null);
  const cleanup = effect();
  listeners.get("popstate")();
  listeners.get("popstate")();
  listeners.get("pageshow")({ persisted: true });
  assert.equal(frames.size, 1, "events in the same transition must be deduplicated");
  [...frames.values()][0]();
  assert.equal(refreshes, 1);

  listeners.get("pageshow")({ persisted: false });
  assert.equal(frames.size, 1, "ordinary pageshow must not schedule a refresh");
  frames.delete(1);
  cleanup();
  assert.equal(listeners.size, 0);
});

test("cleanup cancels a scheduled route refresh", () => {
  const listeners = new Map();
  let effect;
  let refreshes = 0;
  let frame;
  const window = {
    addEventListener: (type, listener) => listeners.set(type, listener),
    removeEventListener: (type) => listeners.delete(type),
    requestAnimationFrame: (callback) => { frame = callback; return 1; },
    cancelAnimationFrame: () => { frame = undefined; },
  };
  const exports = {};
  const filename = path.resolve("src/components/NavigationRecovery.tsx");
  const compiled = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
      esModuleInterop: true,
    },
  }).outputText;
  vm.runInNewContext(compiled, {
    exports,
    window,
    require: (name) => {
      if (name === "react") return { useEffect: (callback) => { effect = callback; } };
      if (name === "next/navigation") return { useRouter: () => ({ refresh: () => { refreshes++; } }) };
      if (name === "react/jsx-runtime") return {};
      return require(name);
    },
  });
  exports.default();
  const cleanup = effect();
  listeners.get("popstate")();
  cleanup();
  frame?.();
  assert.equal(refreshes, 0);
});
