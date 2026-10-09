/// <reference lib="webworker" />
// Runs one compiled C/C++ program (a WASI module) and exits. The main thread
// terminate()s this worker on a timeout; replacing it costs only this small file.
import type { FromProgram, ToProgram } from "../runner/clang-protocol";

declare const self: DedicatedWorkerGlobalScope;
const post = (msg: FromProgram) => self.postMessage(msg);

const ESUCCESS = 0, EBADF = 8, ENOSYS = 52, ESPIPE = 70;
// Output is posted as it is written, up to POSTS_PER_WINDOW messages per WINDOW_MS; beyond
// that (a print loop) it is batched. Batching purely by time would lose the last lines of a
// program that prints and then hangs: a busy loop never writes again to trigger the flush.
const FLUSH_BYTES = 8 * 1024;
const WINDOW_MS = 50;
const POSTS_PER_WINDOW = 20;

class Exit extends Error { constructor(readonly code: number) { super(`exit ${code}`); } }
class OutputLimit extends Error {}

/** Turns a WebAssembly trap into words a student can act on. */
function describeCrash(e: unknown): string {
  const message = e instanceof Error ? e.message : String(e);
  // Each engine words its traps differently (Chrome / Firefox / Safari), e.g.
  // "Maximum call stack size exceeded" / "too much recursion", "memory access out of bounds" /
  // "Out of bounds memory access", "divide by zero" / "Division by zero".
  if (/call stack|too much recursion/i.test(message)) return "stack overflow (infinite or very deep recursion?)";
  if (/out of bounds/i.test(message)) return "invalid memory access (like a segmentation fault: bad pointer or array index)";
  if (/unreachable/i.test(message)) return "aborted (abort() was called or an assert failed)";
  if (/divi(de|sion) by zero/i.test(message)) return "integer division by zero";
  if (/integer overflow/i.test(message)) return "integer overflow in division";
  return message;
}

self.onmessage = async ({ data }: MessageEvent<ToProgram>) => {
  const t0 = performance.now();
  const stdin = new TextEncoder().encode(data.stdin);
  let stdinPos = 0;
  let written = 0;
  let truncated = false;
  let memory!: WebAssembly.Memory;
  const view = () => new DataView(memory.buffer);
  const decoders = { stdout: new TextDecoder(), stderr: new TextDecoder() };

  let chunks: { stream: "stdout" | "stderr"; text: string }[] = [];
  let pendingBytes = 0;
  let windowStart = -Infinity;
  let postsInWindow = 0;
  const flush = () => {
    for (const c of chunks) post({ type: "out", stream: c.stream, text: c.text });
    chunks = [];
    pendingBytes = 0;
  };
  const maybeFlush = () => {
    const now = performance.now();
    if (now - windowStart >= WINDOW_MS) { windowStart = now; postsInWindow = 0; }
    if (pendingBytes >= FLUSH_BYTES || postsInWindow < POSTS_PER_WINDOW) { flush(); postsInWindow++; }
  };

  const wasi: Record<string, (...args: never[]) => number> = {
    args_sizes_get(argc: number, bufSize: number) {
      view().setUint32(argc, 1, true);
      view().setUint32(bufSize, 5, true);
      return ESUCCESS;
    },
    args_get(argv: number, buf: number) {
      new Uint8Array(memory.buffer).set(new TextEncoder().encode("main\0"), buf);
      view().setUint32(argv, buf, true);
      return ESUCCESS;
    },
    environ_sizes_get(count: number, size: number) {
      view().setUint32(count, 0, true);
      view().setUint32(size, 0, true);
      return ESUCCESS;
    },
    environ_get: () => ESUCCESS,
    fd_write(fd: number, iovs: number, iovsLen: number, nwritten: number) {
      if (fd !== 1 && fd !== 2) return EBADF;
      const stream = fd === 1 ? "stdout" : "stderr";
      const dv = view();
      let total = 0;
      for (let i = 0; i < iovsLen; i++) {
        const ptr = dv.getUint32(iovs + i * 8, true);
        const len = dv.getUint32(iovs + i * 8 + 4, true);
        const take = Math.min(len, data.outputCap - written);
        const text = decoders[stream].decode(new Uint8Array(memory.buffer, ptr, take), { stream: true });
        const last = chunks[chunks.length - 1];
        if (last?.stream === stream) last.text += text;
        else chunks.push({ stream, text });
        written += take;
        pendingBytes += take;
        total += len;
        if (take < len) { truncated = true; throw new OutputLimit(); }
      }
      maybeFlush();
      dv.setUint32(nwritten, total, true);
      return ESUCCESS;
    },
    fd_read(fd: number, iovs: number, iovsLen: number, nread: number) {
      if (fd !== 0) return EBADF;
      const dv = view();
      let total = 0;
      for (let i = 0; i < iovsLen; i++) {
        const ptr = dv.getUint32(iovs + i * 8, true);
        const len = dv.getUint32(iovs + i * 8 + 4, true);
        const chunk = stdin.subarray(stdinPos, stdinPos + len);
        new Uint8Array(memory.buffer, ptr, chunk.length).set(chunk);
        stdinPos += chunk.length;
        total += chunk.length;
        if (chunk.length < len) break;
      }
      dv.setUint32(nread, total, true);
      return ESUCCESS;
    },
    fd_fdstat_get(fd: number, buf: number) {
      if (fd > 2) return EBADF;
      const dv = view();
      dv.setUint8(buf, 2); // character device
      dv.setUint16(buf + 2, 0, true);
      dv.setBigUint64(buf + 8, 0xffffffffn, true);
      dv.setBigUint64(buf + 16, 0xffffffffn, true);
      return ESUCCESS;
    },
    fd_close: () => ESUCCESS,
    fd_seek: () => ESPIPE,
    fd_prestat_get: () => EBADF,
    fd_prestat_dir_name: () => EBADF,
    proc_exit(code: number) { throw new Exit(code); },
    clock_time_get(_id: number, _precision: bigint, out: number) {
      view().setBigUint64(out, BigInt(Math.round((performance.timeOrigin + performance.now()) * 1e6)), true);
      return ESUCCESS;
    },
    random_get(buf: number, len: number) {
      crypto.getRandomValues(new Uint8Array(memory.buffer, buf, len));
      return ESUCCESS;
    },
    sched_yield: () => ESUCCESS,
  };

  let exitCode = 0;
  let crash: string | undefined;
  try {
    const module = await WebAssembly.compile(data.wasm as Uint8Array<ArrayBuffer>);
    const imports: Record<string, Record<string, (...args: never[]) => number>> = {};
    for (const imp of WebAssembly.Module.imports(module)) {
      if (imp.kind !== "function") continue;
      imports[imp.module] ??= {};
      // Anything a student's program needs beyond console I/O (files, sockets…) reports "not supported".
      imports[imp.module][imp.name] = wasi[imp.name] ?? (() => ENOSYS);
    }
    const instance = await WebAssembly.instantiate(module, imports);
    memory = instance.exports.memory as WebAssembly.Memory;
    (instance.exports._start as () => void)();
  } catch (e) {
    if (e instanceof Exit) exitCode = e.code;
    else if (e instanceof OutputLimit) exitCode = -1;
    else { exitCode = -1; crash = describeCrash(e); }
  }
  flush();
  post({ type: "done", exitCode, crash, truncated, ms: performance.now() - t0 });
};
