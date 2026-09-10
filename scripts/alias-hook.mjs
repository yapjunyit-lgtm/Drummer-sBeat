/*
 * Lets plain-Node verify scripts import app modules the way the app does.
 *
 * Node has no knowledge of tsconfig, so a module that imports "@/lib/foo"
 * (the project's path alias) cannot be loaded by `node` on its own. Registering
 * this as a resolve hook teaches it that one alias:
 *
 *   node --import ./scripts/alias-hook.mjs scripts/verify-<name>.mts
 *
 * It maps "@/<path>" onto ./src/<path>, trying the extensions Node's ESM
 * resolver will not guess by itself. Nothing here touches the browser or the
 * app build — it only affects opt-in `node --import` runs.
 */

import { registerHooks } from "node:module";
import { statSync } from "node:fs";
import { dirname, resolve as resolvePath } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/** scripts/ lives directly under the project root. */
const srcRoot = resolvePath(dirname(fileURLToPath(import.meta.url)), "..", "src");

/* "" first so an already-qualified import wins over a guessed extension. */
const EXTENSIONS = ["", ".ts", ".tsx", ".mts", ".js"];

function isFile(path) {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith("@/")) {
      const base = resolvePath(srcRoot, specifier.slice(2));
      for (const extension of EXTENSIONS) {
        const candidate = base + extension;
        if (isFile(candidate)) {
          return { url: pathToFileURL(candidate).href, shortCircuit: true };
        }
      }
    }
    return nextResolve(specifier, context);
  },
});
