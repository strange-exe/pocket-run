// Copies the Pyodide runtime from node_modules into public/pyodide/<version>/ so it is
// served (and precached by the service worker) from our own origin. The version in the
// path keeps loader and wasm in step across upgrades and lets the service worker reuse
// the browser's HTTP cache instead of downloading the runtime a second time.
import { copyFile, mkdir, readFile, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const from = join(root, "node_modules", "pyodide");
const { version } = JSON.parse(await readFile(join(from, "package.json"), "utf8"));
const base = join(root, "public", "pyodide");
const to = join(base, version);
const files = ["pyodide.mjs", "pyodide.asm.mjs", "pyodide.asm.wasm", "python_stdlib.zip", "pyodide-lock.json"];

await rm(base, { recursive: true, force: true }); // drop runtimes from older versions
await mkdir(to, { recursive: true });
await Promise.all(files.map((f) => copyFile(join(from, f), join(to, f))));
console.log(`copied ${files.length} Pyodide ${version} files to public/pyodide/${version}`);
