/// <reference lib="webworker" />
// Python runtime worker (Pyodide). One worker = one warm interpreter.
import type { PyodideAPI } from "pyodide";
import { waitForInput } from "../runner/input-channel";
import type { BootSource, FromWorker, Stream, ToWorker } from "../runner/protocol";
import { lockDown } from "./lockdown";

declare const self: DedicatedWorkerGlobalScope;
const post = (msg: FromWorker) => self.postMessage(msg);
// Private references, taken before lockDown() removes these from the global scope.
// Student code can't reach module variables, only globals.
const cacheStorage = self.caches;

// Runs user code in a fresh namespace and formats errors the way CPython does,
// minus our own wrapper frame. Returns (exit_code, interrupted, recycle).
// Every run shares this interpreter's sys, os and signal modules, so whatever a program changes
// there (sys.stdout = io.StringIO(), the recursion limit, os.environ, a Ctrl+C handler) is put
// back before the next run. Its own streams are restored before an error is reported, so the
// traceback can't vanish into a replaced sys.stderr. If it closed the real stdout or stderr,
// only a new interpreter gets them back: recycle.
const RUNNER_PY = `
import os, signal, sys, traceback

def __pocket_run_restore(saved):
    streams, limit, environ = saved
    sys.stdin, sys.stdout, sys.stderr = streams
    sys.setrecursionlimit(limit)
    if dict(os.environ) != environ:
        os.environ.clear()
        os.environ.update(environ)
    signal.signal(signal.SIGINT, signal.default_int_handler)

def __pocket_run(code, filename):
    saved = ((sys.stdin, sys.stdout, sys.stderr), sys.getrecursionlimit(), dict(os.environ))
    signal.signal(signal.SIGINT, signal.default_int_handler)
    namespace = {"__name__": "__main__", "__file__": filename}
    exit_code, interrupted, out_of_memory = 0, False, False
    try:
        exec(compile(code, filename, "exec"), namespace)
    except SystemExit as e:
        __pocket_run_restore(saved)
        if e.code is None:
            exit_code = 0
        elif isinstance(e.code, int):
            exit_code = e.code
        else:
            print(e.code, file=sys.stderr)
            exit_code = 1
    except KeyboardInterrupt:
        exit_code, interrupted = 130, True
    except BaseException as e:
        __pocket_run_restore(saved)
        exit_code, out_of_memory = 1, isinstance(e, MemoryError)
        try:
            traceback.print_exception(type(e), e, e.__traceback__.tb_next)
        except KeyboardInterrupt:  # Stop pressed while the error was being reported
            exit_code, interrupted = 130, True
    finally:
        __pocket_run_restore(saved)
        for stream in (sys.stdout, sys.stderr):
            try:
                stream.flush()
            except Exception:
                pass
    closed = any(getattr(stream, "closed", False) for stream in saved[0])
    return (exit_code, interrupted, out_of_memory or closed)
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

/** The stored snapshot, or why there is none to use. */
async function readSnapshot(key: string): Promise<{ bytes: Uint8Array } | { note: string }> {
  try {
    const hit = await (await cacheStorage.open(SNAPSHOT_CACHE)).match(key);
    return hit ? { bytes: new Uint8Array(await hit.arrayBuffer()) } : { note: "no snapshot stored yet" };
  } catch (e) {
    return { note: `snapshot unreadable: ${describe(e)}` };
  }
}

/** A short, single-line description of an error, for the boot note. */
const describe = (e: unknown) => (e instanceof Error ? `${e.name}: ${e.message}` : String(e)).split("\n")[0].slice(0, 200);

async function saveSnapshot(key: string, snapshot: Uint8Array) {
  try {
    const cache = await cacheStorage.open(SNAPSHOT_CACHE);
    for (const old of await cache.keys()) if (!old.url.endsWith(key)) await cache.delete(old);
    await cache.put(key, new Response(snapshot as Uint8Array<ArrayBuffer>));
  } catch {
    // Storage full or unavailable: the next visit simply starts the slow way.
  }
}

let booting: Promise<PyodideAPI> | undefined;
let bootSource: BootSource = "fresh";
let bootNote: string | undefined;

async function boot(interrupt: SharedArrayBuffer | null): Promise<PyodideAPI> {
  // Load the loader from our own origin so it always matches the precached runtime files.
  const indexURL = `/pyodide/${__PYODIDE_DIR__}/`;
  const loaderUrl = new URL(`${indexURL}pyodide.mjs`, self.location.origin).href;
  const { loadPyodide } = (await import(/* @vite-ignore */ loaderUrl)) as typeof import("pyodide");
  // Keyed by the folder (version and memory cap): a snapshot from another runtime build is never reused.
  const key = `/python-snapshot/${__PYODIDE_DIR__}`;

  let py: PyodideAPI | null = null;
  const snapshot = await readSnapshot(key);
  if ("bytes" in snapshot) {
    try {
      py = await loadPyodide({ indexURL, _loadSnapshot: snapshot.bytes });
      bootSource = "snapshot";
      bootNote = undefined;
    } catch (e) {
      bootNote = `snapshot rejected: ${describe(e)}`;
      await cacheStorage.delete(SNAPSHOT_CACHE).catch(() => {}); // corrupt or incompatible: start fresh
    }
  } else {
    bootNote = snapshot.note;
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
  // Fail closed: never run student code with storage or network still reachable.
  const reachable = lockDown(self);
  if (reachable.length) throw new Error(`couldn't isolate Python from: ${reachable.join(", ")}`);
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
      post({ type: "ready", ms: performance.now() - t0, source: bootSource, note: bootNote });
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
    // Only a KeyboardInterrupt landing in the wrapper's own last steps can get here. Its clean-up
    // may not have finished, so start the next run from a new interpreter.
    recycle = true;
  } finally {
    run.destroy();
  }
  flush();
  post({ type: "done", exitCode, interrupted, recycle, ms: performance.now() - t0 - waitedMs });
};
