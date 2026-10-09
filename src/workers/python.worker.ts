/// <reference lib="webworker" />
// Python runtime worker (Pyodide). One worker = one warm interpreter.
import type { PyodideAPI } from "pyodide";
import type { BootSource, FromWorker, Stream, ToWorker } from "../runner/protocol";

declare const self: DedicatedWorkerGlobalScope;
const post = (msg: FromWorker) => self.postMessage(msg);

// Runs user code in a fresh namespace and formats errors the way CPython does,
// minus our own wrapper frame. Returns (exit_code, interrupted, recycle).
const RUNNER_PY = `
import sys, traceback

def __pocket_run(code, filename):
    namespace = {"__name__": "__main__", "__file__": filename}
    try:
        exec(compile(code, filename, "exec"), namespace)
        return (0, False, False)
    except SystemExit as e:
        if e.code is None:
            return (0, False, False)
        if isinstance(e.code, int):
            return (e.code, False, False)
        print(e.code, file=sys.stderr)
        return (1, False, False)
    except KeyboardInterrupt:
        return (130, True, False)
    except BaseException as e:
        traceback.print_exception(type(e), e, e.__traceback__.tb_next)
        return (1, False, isinstance(e, MemoryError))
    finally:
        sys.stdout.flush()
        sys.stderr.flush()
`;

// Output is posted as it is written, up to POSTS_PER_WINDOW messages per WINDOW_MS; beyond
// that (a print() loop) it is batched so the main thread isn't flooded. runPython is
// synchronous, so no timer can flush later: batching purely by time would lose the last
// lines of a program that prints and then hangs in C code (killed, never writes again).
const FLUSH_BYTES = 8 * 1024;
const WINDOW_MS = 50;
const POSTS_PER_WINDOW = 20;
let chunks: { stream: Stream; text: string }[] = [];
let pendingBytes = 0;
let windowStart = -Infinity;
let postsInWindow = 0;

function flush() {
  for (const c of chunks) post({ type: "out", stream: c.stream, text: c.text });
  chunks = [];
  pendingBytes = 0;
}

function maybeFlush() {
  const now = performance.now();
  if (now - windowStart >= WINDOW_MS) { windowStart = now; postsInWindow = 0; }
  if (pendingBytes >= FLUSH_BYTES || postsInWindow < POSTS_PER_WINDOW) { flush(); postsInWindow++; }
}

function writer(stream: Stream) {
  const decoder = new TextDecoder();
  return {
    isatty: false,
    write(buffer: Uint8Array): number {
      const text = decoder.decode(buffer, { stream: true });
      const last = chunks[chunks.length - 1];
      if (last?.stream === stream) last.text += text;
      else chunks.push({ stream, text });
      pendingBytes += buffer.length;
      maybeFlush();
      return buffer.length;
    },
  };
}

// A full Python start-up takes ~3 s on a phone; restoring a memory snapshot of an
// already-started interpreter takes ~0.6 s. The snapshot is made on this device after
// its first start (no extra download) and kept per Pyodide version. Snapshots are a
// private Pyodide API, which is why the package is pinned to an exact version.
const SNAPSHOT_CACHE = "pocket-run-python-snapshot";

async function readSnapshot(key: string): Promise<Uint8Array | null> {
  try {
    const hit = await (await caches.open(SNAPSHOT_CACHE)).match(key);
    return hit ? new Uint8Array(await hit.arrayBuffer()) : null;
  } catch {
    return null;
  }
}

async function saveSnapshot(key: string, snapshot: Uint8Array) {
  try {
    const cache = await caches.open(SNAPSHOT_CACHE);
    for (const old of await cache.keys()) if (!old.url.endsWith(key)) await cache.delete(old);
    await cache.put(key, new Response(snapshot as Uint8Array<ArrayBuffer>));
  } catch {
    // Storage full or unavailable: the next visit simply starts the slow way.
  }
}

let booting: Promise<PyodideAPI> | undefined;
let bootSource: BootSource = "fresh";

async function boot(interrupt: SharedArrayBuffer | null): Promise<PyodideAPI> {
  // Load the loader from our own origin so it always matches the precached runtime files.
  const indexURL = `/pyodide/${__PYODIDE_VERSION__}/`;
  const loaderUrl = new URL(`${indexURL}pyodide.mjs`, self.location.origin).href;
  const { loadPyodide, version } = (await import(/* @vite-ignore */ loaderUrl)) as typeof import("pyodide");
  const key = `/python-snapshot/${version}`;

  let py: PyodideAPI | null = null;
  const snapshot = await readSnapshot(key);
  if (snapshot) {
    try {
      py = await loadPyodide({ indexURL, _loadSnapshot: snapshot });
      bootSource = "snapshot";
    } catch {
      await caches.delete(SNAPSHOT_CACHE).catch(() => {}); // corrupt or incompatible: start fresh
    }
  }
  if (!py) {
    py = await loadPyodide({ indexURL, _makeSnapshot: true });
    bootSource = "fresh";
    // Taken before any per-session setup (stdout, interrupts), so it is a clean interpreter.
    const made = py.makeMemorySnapshot();
    setTimeout(() => void saveSnapshot(key, made), 0); // after "ready" is posted
  }

  if (interrupt) py.setInterruptBuffer(new Uint8Array(interrupt));
  py.setStdout(writer("stdout"));
  py.setStderr(writer("stderr"));
  py.runPython(RUNNER_PY);
  return py;
}

self.onmessage = async ({ data }: MessageEvent<ToWorker>) => {
  if (data.type === "init") {
    const t0 = performance.now();
    booting = boot(data.interrupt);
    try {
      await booting;
      post({ type: "ready", ms: performance.now() - t0, source: bootSource });
    } catch (e) {
      post({ type: "boot-failed", error: String(e) });
    }
    return;
  }

  const py = await booting!;
  let stdin: string | null = data.stdin;
  py.setStdin({ stdin: () => { const s = stdin; stdin = null; return s || null; } });

  const t0 = performance.now();
  const run = py.globals.get("__pocket_run");
  const result = run(data.code, data.filename);
  const [exitCode, interrupted, recycle] = result.toJs() as [number, boolean, boolean];
  result.destroy();
  run.destroy();
  flush();
  post({ type: "done", exitCode, interrupted, recycle, ms: performance.now() - t0 });
};
