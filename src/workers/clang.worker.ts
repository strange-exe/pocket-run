/// <reference lib="webworker" />
// C/C++ compiler worker: downloads the toolchain pack once, keeps clang + lld warm,
// and turns one source file into a WASI program for the runner worker.
import API from "../vendor/wasm-clang/shared.js";
import type { CLang, FromCompiler, ToCompiler } from "../runner/clang-protocol";

declare const self: DedicatedWorkerGlobalScope;
const post = (msg: FromCompiler, transfer: Transferable[] = []) => self.postMessage(msg, transfer);

const PACK = __CLANG_PACK__;
const CACHE = `pocket-run-cpp-${PACK.version}`;
const key = (name: string) => `/cpp-pack/${PACK.version}/${name}`;
const COMPLETE = key("complete");
/** What the student downloads: everything except the licence text. */
const TOOLCHAIN = ["clang", "lld", "sysroot.tar", "memfs"] as const;

// bits/stdc++.h is GCC-only, but students include it constantly; ship an equivalent.
const STDCXX_SHIM = [
  "algorithm", "array", "bitset", "cassert", "cctype", "cfloat", "chrono", "climits", "cmath",
  "complex", "cstdint", "cstdio", "cstdlib", "cstring", "ctime", "deque", "functional",
  "iomanip", "iostream", "iterator", "limits", "list", "map", "memory", "numeric", "optional",
  "queue", "random", "set", "sstream", "stack", "string", "string_view", "tuple",
  "unordered_map", "unordered_set", "utility", "variant", "vector",
].map((h) => `#include <${h}>`).join("\n") + "\n";
// "#pragma once" lets a precompiled copy stand in for the student's own #include of it.
const STDCXX_HEADER = "#pragma once\n" + STDCXX_SHIM;

const CXX_FLAGS = ["-O2", "-std=c++17"];

// Linked into every program. C's printf("Enter n: ") stays in stdout's buffer until a newline,
// so with live input the prompt wouldn't show before scanf waits. (C++'s cin flushes cout by
// itself; C doesn't.) A separate object, not an injected header, so students' code and its
// line numbers are untouched.
const INIT_OBJECT = "pocket_run_init.o";
const INIT_SOURCE = `#include <stdio.h>
__attribute__((constructor)) static void pocket_run_unbuffered_stdout(void) {
  setvbuf(stdout, NULL, _IONBF, 0);
}
`;
const USES_BITS = /^\s*#\s*include\s*<bits\/stdc\+\+\.h>/m;

// ---------- the pack: download once, verify, keep in Cache Storage ----------

async function isInstalled(): Promise<boolean> {
  try {
    return !!(await (await caches.open(CACHE)).match(COMPLETE));
  } catch {
    return false;
  }
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as Uint8Array<ArrayBuffer>);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function fetchFile(name: string, onBytes: (n: number) => void): Promise<Uint8Array> {
  const spec = PACK.files[name];
  const res = await fetch(`/clang/${PACK.version}/${spec.path}`, { cache: "no-store" });
  if (!res.ok || !res.body) throw new Error(`${spec.path}: HTTP ${res.status}`);
  const chunks: Uint8Array[] = [];
  const reader = res.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    onBytes(value.length);
  }
  let blob = new Blob(chunks as Uint8Array<ArrayBuffer>[]);
  // Decide by content, not by name: a server may already have removed the gzip layer.
  const head = new Uint8Array(await blob.slice(0, 2).arrayBuffer());
  if (head[0] === 0x1f && head[1] === 0x8b) {
    blob = await new Response(blob.stream().pipeThrough(new DecompressionStream("gzip"))).blob();
  }
  const bytes = new Uint8Array(await blob.arrayBuffer());
  if ((await sha256Hex(bytes)) !== spec.sha256) throw new Error(`${spec.path} is damaged (checksum mismatch)`);
  return bytes;
}

async function download() {
  const total = TOOLCHAIN.reduce((n, f) => n + PACK.files[f].bytes, 0);
  let loaded = 0;
  let lastPost = 0;
  const onBytes = (n: number) => {
    loaded += n;
    if (performance.now() - lastPost > 100) { lastPost = performance.now(); post({ type: "progress", loaded, total }); }
  };
  const cache = await caches.open(CACHE);
  for (const name of TOOLCHAIN) {
    if (await cache.match(key(name))) { loaded += PACK.files[name].bytes; continue; } // resume a partial pack
    let bytes: Uint8Array | null = null;
    for (let attempt = 1; !bytes; attempt++) {
      const before = loaded;
      try {
        bytes = await fetchFile(name, onBytes);
      } catch (e) {
        loaded = before;
        if (attempt === 3) throw e;
        await new Promise((r) => setTimeout(r, attempt * 1500));
      }
    }
    const type = name === "sysroot.tar" ? "application/x-tar" : "application/wasm";
    await cache.put(key(name), new Response(bytes as Uint8Array<ArrayBuffer>, { headers: { "Content-Type": type } }));
  }
  await cache.put(COMPLETE, new Response("ok"));
  post({ type: "progress", loaded: total, total });
  // Packs from older toolchain versions are dead weight on a small phone.
  for (const name of await caches.keys()) if (name.startsWith("pocket-run-cpp-") && name !== CACHE) await caches.delete(name);
}

// ---------- the compiler ----------

let diagnostics = "";
let api: API | null = null;
let booting: Promise<API> | null = null;

async function cached(name: string): Promise<Response> {
  const hit = await (await caches.open(CACHE)).match(key(name));
  if (!hit) throw new Error(`C/C++ pack is missing ${name}`);
  return hit;
}

async function boot(): Promise<API> {
  const a = new API({
    readBuffer: async (name) => (await cached(name)).arrayBuffer(),
    compileStreaming: async (name) => WebAssembly.compileStreaming(cached(name)),
    hostWrite: (text) => { diagnostics += text; },
    clang: "clang", lld: "lld", memfs: "memfs", sysroot: "sysroot.tar",
  });
  // Keep only tool output: no progress chatter, no colour codes.
  a.hostLog = () => {};
  a.hostLogAsync = (_message, promise) => promise;
  a.clangCommonArgs = a.clangCommonArgs.filter((arg) => arg !== "-fcolor-diagnostics");
  await a.ready;
  a.memfs.addFile("include/bits/stdc++.h", STDCXX_HEADER);
  const clang = await a.getModule(a.clangFilename);
  await a.getModule(a.lldFilename);
  a.memfs.addFile("pocket_run_init.c", INIT_SOURCE);
  try {
    await a.run(clang, "clang", "-cc1", "-emit-obj", ...cOnly(a.clangCommonArgs), "-O2", "-std=gnu11", "-o", INIT_OBJECT, "-x", "c", "pocket_run_init.c");
  } catch {
    throw new Error("the C/C++ start-up code failed to compile");
  }
  return a;
}

/** clang's C++ headers must not be on the C include path (they shadow <math.h> etc.). */
function cOnly(args: string[]): string[] {
  return args.filter((arg, i, all) => arg !== "/include/c++/v1" && !(arg === "-internal-isystem" && all[i + 1] === "/include/c++/v1"));
}

/** Runs clang or wasm-ld in the shared memfs; false when the tool exits non-zero. */
async function tool(module: WebAssembly.Module, ...args: string[]): Promise<boolean> {
  try {
    await api!.run(module, ...args);
    return true;
  } catch {
    return false;
  }
}

function cleanDiagnostics(text: string): string {
  return text
    .replace(/\x1b\[[0-9;]*m/g, "")
    .split("\n")
    .filter((line) => !/^Error: process exited with code \d+\.?$/.test(line.trim()))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// ---------- precompiled <bits/stdc++.h> ----------
// Parsing the ~40 headers behind bits/stdc++.h dominates compile time (measured: 1.8 s → 0.7 s
// on desktop with a PCH). The PCH is built on the first compile that needs it, then kept in the
// pack's cache. Its key hashes the header and flags, so changing either can never reuse a stale one.
const PCH_FILE = "stdcpp.pch";
let pch: "unknown" | "ready" | "unavailable" = "unknown";

async function pchKey(): Promise<string> {
  const id = await sha256Hex(new TextEncoder().encode(STDCXX_HEADER + api!.clangCommonArgs.join(" ") + CXX_FLAGS.join(" ")));
  return key(`stdcpp-${id.slice(0, 16)}.pch`);
}

async function ensurePch(clang: WebAssembly.Module): Promise<boolean> {
  if (pch !== "unknown") return pch === "ready";
  try {
    const cache = await caches.open(CACHE);
    const k = await pchKey();
    const hit = await cache.match(k);
    if (hit) {
      api!.memfs.addFile(PCH_FILE, new Uint8Array(await hit.arrayBuffer()));
      pch = "ready";
      return true;
    }
    if (!(await tool(clang, "clang", "-cc1", "-emit-pch", ...api!.clangCommonArgs, ...CXX_FLAGS,
      "-o", PCH_FILE, "-x", "c++-header", "/include/bits/stdc++.h"))) {
      pch = "unavailable";
      return false;
    }
    const bytes = api!.memfs.getFileContents(PCH_FILE).slice();
    pch = "ready";
    // Old PCHs (other flags or header list) are dead weight.
    for (const req of await cache.keys()) if (/\/stdcpp-[0-9a-f]+\.pch$/.test(req.url) && !req.url.endsWith(k)) await cache.delete(req);
    await cache.put(k, new Response(bytes as Uint8Array<ArrayBuffer>));
    return true;
  } catch {
    pch = "unavailable"; // storage full or blocked: compile the slow way
    return false;
  }
}

async function forgetPch() {
  pch = "unavailable";
  try { await (await caches.open(CACHE)).delete(await pchKey()); } catch {}
}

async function compile(lang: CLang, code: string) {
  const isC = lang === "c";
  const src = isC ? "main.c" : "main.cpp";
  api!.memfs.addFile(src, code);
  const common = isC ? cOnly(api!.clangCommonArgs) : api!.clangCommonArgs;
  const clang = await api!.getModule(api!.clangFilename);
  const lld = await api!.getModule(api!.lldFilename);

  // -O2 matches what most online judges use.
  const cc = (extra: string[]) => tool(clang, "clang", "-cc1", "-emit-obj", ...common,
    ...(isC ? ["-O2", "-std=gnu11"] : CXX_FLAGS), ...extra, "-o", "main.o", "-x", isC ? "c" : "c++", src);
  const usePch = !isC && USES_BITS.test(code) && (await ensurePch(clang));
  diagnostics = "";
  let compiled = await cc(usePch ? ["-include-pch", PCH_FILE] : []);
  // Only retry for PCH problems ("PCH file was compiled…", "malformed or corrupted AST file"):
  // ordinary mistakes in the student's code must not pay for a second compile.
  if (!compiled && usePch && /precompiled header|PCH file|AST file/i.test(diagnostics)) {
    await forgetPch(); // a PCH clang won't accept: drop it and compile normally
    diagnostics = "";
    compiled = await cc([]);
  }
  if (!compiled) return { ok: false, diagnostics: explain(cleanDiagnostics(diagnostics)) };

  const warnings = cleanDiagnostics(diagnostics);
  diagnostics = "";
  const linked = await tool(lld, "wasm-ld", "--no-threads", "-z", "stack-size=1048576",
    // Programs may use at most 256 MB, so a memory bomb cannot take down the phone's browser.
    "--max-memory=268435456", "-Llib/wasm32-wasi", "lib/wasm32-wasi/crt1.o", INIT_OBJECT, "main.o",
    "-lc", "-lc++", "-lc++abi",
    // compiler-rt: 128-bit long double helpers (__lttf2 …) that libc++ needs.
    "lib/clang/8.0.1/lib/wasi/libclang_rt.builtins-wasm32.a", "-o", "main.wasm");
  if (!linked) return { ok: false, diagnostics: explain(cleanDiagnostics(diagnostics)) };

  const wasm = api!.memfs.getFileContents("main.wasm").slice(); // copy out of memfs memory
  return { ok: true, wasm, diagnostics: warnings };
}

/** Adds a plain-language note for limits of this offline toolchain. */
function explain(text: string): string {
  if (/with exceptions disabled/.test(text)) {
    return `${text}\n\nNote: C++ exceptions (try / throw / catch) are not supported by Pocket Run's offline compiler.`;
  }
  if (/undefined symbol: main\b/.test(text)) return `${text}\n\nNote: the program needs an int main() function.`;
  return text;
}

self.onmessage = async ({ data }: MessageEvent<ToCompiler>) => {
  switch (data.type) {
    case "check":
      post({ type: "pack", installed: await isInstalled() });
      return;
    case "download":
      try {
        await download();
        post({ type: "pack", installed: true });
      } catch (e) {
        post({ type: "download-failed", error: (e as Error).message });
      }
      return;
    case "boot": {
      const t0 = performance.now();
      booting ??= boot();
      try {
        api = await booting;
        post({ type: "ready", ms: performance.now() - t0 });
      } catch (e) {
        booting = null;
        post({ type: "boot-failed", error: (e as Error).message });
      }
      return;
    }
    case "compile": {
      const t0 = performance.now();
      const r = await compile(data.lang, data.code);
      const ms = performance.now() - t0;
      if (r.ok) post({ type: "compiled", id: data.id, ok: true, wasm: r.wasm, diagnostics: r.diagnostics, ms }, [r.wasm!.buffer]);
      else post({ type: "compiled", id: data.id, ok: false, diagnostics: r.diagnostics, ms });
    }
  }
};
