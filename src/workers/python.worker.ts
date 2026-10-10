/// <reference lib="webworker" />
// Python runtime worker (Pyodide). One worker = one warm interpreter.
import type { PyodideAPI } from "pyodide";
import { waitForInput } from "../runner/input-channel";
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
        try:
            traceback.print_exception(type(e), e, e.__traceback__.tb_next)
        except KeyboardInterrupt:  # Stop pressed while the error was being reported
            return (130, True, False)
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

  if (interrupt) {
    interruptFlag = new Uint8Array(interrupt);
    py.setInterruptBuffer(interruptFlag);
  }
  py.setStdout(writer("stdout"));
  py.setStderr(writer("stderr"));
  py.runPython(RUNNER_PY);
  return py;
}

let inputChannel: SharedArrayBuffer | null = null;
let interruptFlag: Uint8Array | null = null;

self.onmessage = async ({ data }: MessageEvent<ToWorker>) => {
  if (data.type === "init") {
    const t0 = performance.now();
    inputChannel = data.input;
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
  // The Input box first; after that, ask the student while the program runs (if possible).
  // A last line typed without Enter is still a complete line, not a request for more.
  let pending: Uint8Array = new TextEncoder().encode(data.stdin && !data.stdin.endsWith("\n") ? data.stdin + "\n" : data.stdin);
  let ended = !inputChannel;
  let waitedMs = 0;
  // read() is called once per read, with a buffer to fill. It returns what's available (the rest of
  // the Input box, or one live line) and only waits when nothing is left, like a terminal. (The
  // stdin() callback style keeps asking for more to fill Python's buffer, so a live line never
  // got back to the program.) Returning 0 means end of input.
  py.setStdin({
    read: (buffer: Uint8Array) => {
      if (!pending.length && !ended) {
        flush(); // the prompt (e.g. input("Name: ")) must be on screen before we wait
        const t = performance.now();
        const line = waitForInput(inputChannel!, () => post({ type: "input-request" }));
        waitedMs += performance.now() - t;
        // Woken by Stop rather than by "End input": stop right here, so the program sees a
        // KeyboardInterrupt, not a fake end-of-file it might handle and carry on from.
        if (!line && interruptFlag?.[0] === 2) py.checkInterrupt();
        if (line) pending = line;
        else ended = true;
      }
      const n = Math.min(buffer.length, pending.length);
      buffer.set(pending.subarray(0, n));
      pending = pending.subarray(n);
      return n;
    },
  });

  const t0 = performance.now();
  const run = py.globals.get("__pocket_run");
  let exitCode = 130, interrupted = true, recycle = false;
  try {
    const result = run(data.code, data.filename);
    [exitCode, interrupted, recycle] = result.toJs() as [number, boolean, boolean];
    result.destroy();
  } catch {
    // Only a KeyboardInterrupt landing in the wrapper's own last steps can get here.
  } finally {
    run.destroy();
  }
  flush();
  post({ type: "done", exitCode, interrupted, recycle, ms: performance.now() - t0 - waitedMs });
};
