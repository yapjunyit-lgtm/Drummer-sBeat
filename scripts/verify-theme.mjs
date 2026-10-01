/* Run: node scripts/verify-theme.mjs */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

let saved = null, unavailable = false;
const dataset = { theme: "light" };
const meta = { setAttribute: (_name, value) => { meta.content = value; } };
const storage = {
  getItem: () => { if (unavailable) throw Error("storage blocked"); return saved; },
  setItem: (_key, value) => { if (unavailable) throw Error("storage blocked"); saved = value; },
};
const context = vm.createContext({
  exports: {}, localStorage: storage,
  document: { documentElement: { dataset }, querySelector: () => meta },
  require: (name) => name === "react" ? { useLayoutEffect: (fn) => fn() } : { jsx: (_type, props) => props, jsxs: (_type, props) => props },
});
const source = readFileSync(new URL("../src/components/ThemeToggle.tsx", import.meta.url), "utf8");
vm.runInContext(ts.transpileModule(source, { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS } }).outputText, context);
const button = context.exports.default();
assert.equal(dataset.theme, "light");
button.onClick();
assert.equal(dataset.theme, "dark");
assert.equal(saved, "dark");
assert.equal(meta.content, "#171614");

// The pre-paint script and the mounted control must restore the same choice.
const layout = readFileSync(new URL("../src/app/layout.tsx", import.meta.url), "utf8");
const bootstrap = layout.match(/__html: `([^`]+)`/)[1];
dataset.theme = "light";
vm.runInContext(bootstrap, context);
assert.equal(dataset.theme, "dark");
dataset.theme = "light";
context.exports.default();
assert.equal(dataset.theme, "dark");
button.onClick();
assert.equal(saved, "light");
assert.equal(meta.content, "#f5f2eb");
saved = "invalid";
vm.runInContext(bootstrap, context);
assert.equal(dataset.theme, "light");
unavailable = true;
assert.doesNotThrow(() => vm.runInContext(bootstrap, context));
assert.doesNotThrow(() => context.exports.default().onClick());
assert.equal(dataset.theme, "dark");
console.log("Theme: switching, persistence, startup restoration and blocked-storage fallback passed.");
