import type { CLang, FromCompiler, FromProgram, ToCompiler, ToProgram } from "./clang-protocol";
import { createInputChannel, sendInput } from "./input-channel";
import { RunClock, START_ATTEMPTS, type RunOptions, type RunResult, type StopReason } from "./runner";

/** "idle": the pack is installed but clang is not loaded yet (no C/C++ file has been opened). */
export type CppState = "checking" | "absent" | "downloading" | "idle" | "booting" | "ready" | "running" | "failed";

/** Compiling can't be interrupted; past this the compiler is replaced (it reboots from the cache). */
const COMPILE_TIMEOUT_MS = 30_000;

/**
 * C and C++: a warm compiler worker (clang + lld, kept across runs) plus a fresh,
 * disposable worker per program run, so a stuck program never costs a compiler reload.
 */
export class CppRunner {
  state: CppState = "checking";
  progress = { loaded: 0, total: __CLANG_PACK__.totalBytes };
  error = "";
  onState?: (state: CppState) => void;

  private compiler!: Worker;
  private spare: Worker | null = null;
  /** Whether the UI wants the compiler warm (a C/C++ file is open). */
  private wantBoot = false;
  private ready: Promise<void> | null = null;
  private booted = false;
  private nextId = 0;
  private active: { stop: (reason: StopReason) => void; provideInput?: (text: string | null) => void } | null = null;

  constructor(
    private readonly createCompiler: () => Worker,
    private readonly createProgram: () => Worker,
  ) {
    this.startCompiler();
  }

  private setState(state: CppState) {
    this.state = state;
    this.onState?.(state);
  }

  private send(msg: ToCompiler) {
    this.compiler.postMessage(msg);
  }

  private startCompiler(attempt = 1) {
    const compiler = this.createCompiler();
    this.compiler = compiler;
    this.ready = null;
    this.booted = false;
    // A worker that can't even start (see START_ATTEMPTS) errors before its first reply: retry it.
    let replied = false;
    const onStartError = (e: ErrorEvent) => {
      if (replied) return;
      e.preventDefault(); // handled here (we retry); otherwise browsers also report it as uncaught
      compiler.terminate();
      if (attempt < START_ATTEMPTS) {
        setTimeout(() => { if (this.compiler === compiler) this.startCompiler(attempt + 1); }, 250 * attempt);
      } else {
        this.error = e.message || "the C/C++ compiler failed to start";
        this.setState("failed");
      }
    };
    compiler.addEventListener("error", onStartError, { once: true });
    compiler.addEventListener("message", ({ data }: MessageEvent<FromCompiler>) => {
      if (!replied) { replied = true; compiler.removeEventListener("error", onStartError); }
      if (data.type === "pack") {
        if (!data.installed) this.setState("absent");
        else if (this.wantBoot) void this.boot();
        else this.setState("idle");
      }
      if (data.type === "progress") { this.progress = { loaded: data.loaded, total: data.total }; this.onState?.(this.state); }
      if (data.type === "download-failed") { this.error = data.error; this.setState("absent"); }
    });
    this.send({ type: "check" });
  }

  /** Start clang as soon as a C/C++ file is open, so pressing Run doesn't wait for it. */
  prepare() {
    this.wantBoot = true;
    this.spare ??= this.createProgram();
    if (this.state === "idle") void this.boot();
  }

  download() {
    if (this.state !== "absent") return;
    this.error = "";
    this.progress = { loaded: 0, total: __CLANG_PACK__.totalBytes };
    this.wantBoot = true;
    this.setState("downloading");
    this.send({ type: "download" });
  }

  private boot(): Promise<void> {
    if (this.ready) return this.ready;
    if (this.state !== "running") this.setState("booting");
    const compiler = this.compiler;
    this.ready = new Promise((resolve, reject) => {
      const onMessage = ({ data }: MessageEvent<FromCompiler>) => {
        if (data.type !== "ready" && data.type !== "boot-failed") return;
        compiler.removeEventListener("message", onMessage);
        if (data.type === "ready") {
          this.booted = true;
          if (this.state === "booting") this.setState("ready");
          resolve();
        } else {
          this.error = data.error;
          this.ready = null;
          this.setState("failed");
          reject(new Error(data.error));
        }
      };
      compiler.addEventListener("message", onMessage);
    });
    this.ready.catch(() => {});
    this.send({ type: "boot" });
    return this.ready;
  }

  private restartCompiler() {
    this.compiler.terminate();
    this.setState("booting");
    this.startCompiler();
  }

  stop() {
    this.active?.stop("stopped");
  }

  /** Answers the program's request for input: a line (with "\n") or null for end of input. */
  provideInput(text: string | null) {
    this.active?.provideInput?.(text);
  }

  async run(opts: RunOptions & { lang: CLang }): Promise<RunResult> {
    if (this.active) throw new Error("a program is already running");
    if (this.state === "absent" || this.state === "downloading" || this.state === "checking") {
      throw new Error("the C/C++ pack is not installed yet");
    }
    const started = performance.now();

    // ---- phase 1: wait for clang, then compile. Stop works in both. ----
    let stoppedWith: StopReason | null = null;
    let cancel!: (reason: StopReason) => void;
    const cancelled = new Promise<StopReason>((resolve) => { cancel = resolve; });
    this.active = { stop: (reason) => { stoppedWith ??= reason; cancel(reason); } };
    this.setState("running");
    opts.onPhase?.(this.booted ? "compiling" : "starting");

    const id = this.nextId++;
    const compiler = this.compiler;
    let compileSent = false;
    let compileTimeout: ReturnType<typeof setTimeout> | undefined;
    type Compiled = Extract<FromCompiler, { type: "compiled" }>;
    const compile = this.boot().then(async (): Promise<Compiled | StopReason | "compile-timeout"> => {
      if (stoppedWith) return stoppedWith; // stopped while clang was loading: never compile
      compileSent = true;
      opts.onPhase?.("compiling");
      const compiled = new Promise<Extract<FromCompiler, { type: "compiled" }>>((resolve) => {
        const onMessage = ({ data }: MessageEvent<FromCompiler>) => {
          if (data.type === "compiled" && data.id === id) { compiler.removeEventListener("message", onMessage); resolve(data); }
        };
        compiler.addEventListener("message", onMessage);
      });
      // The compile limit starts now: time spent loading clang doesn't count against it.
      const tooSlow = new Promise<"compile-timeout">((resolve) => { compileTimeout = setTimeout(() => resolve("compile-timeout"), COMPILE_TIMEOUT_MS); });
      this.send({ type: "compile", id, lang: opts.lang, code: opts.code });
      return Promise.race([compiled, tooSlow]);
    });

    let outcome: Extract<FromCompiler, { type: "compiled" }> | StopReason | "compile-timeout";
    try {
      outcome = await Promise.race([compile, cancelled]);
    } catch (e) {
      this.active = null;
      throw e;
    } finally {
      clearTimeout(compileTimeout);
    }

    if (typeof outcome === "string") {
      this.active = null;
      if (compileSent) {
        // clang can't be interrupted mid-compile, so replace it (it reloads from the cache).
        this.restartCompiler();
        this.prepare();
      } else {
        this.setState(this.booted ? "ready" : "booting");
      }
      if (outcome === "compile-timeout") opts.onOutput?.({ stream: "stderr", text: `Compiling took longer than ${COMPILE_TIMEOUT_MS / 1000} s and was stopped.\n` });
      return { status: outcome === "compile-timeout" ? "timeout" : outcome, exitCode: null, ms: performance.now() - started, truncated: false, stage: "compile" };
    }
    opts.onPhase?.("running");
    const compileMs = outcome.ms;
    if (outcome.diagnostics) opts.onOutput?.({ stream: "stderr", text: outcome.diagnostics + "\n" });
    if (!outcome.ok) {
      this.active = null;
      this.setState("ready");
      return { status: "compile-error", exitCode: null, ms: compileMs, truncated: false, compileMs };
    }

    // ---- phase 2: run the program in a fresh worker; only this part has the time limit ----
    const firstWorker = this.spare ?? this.createProgram();
    this.spare = this.createProgram(); // warm a replacement for the next run
    return new Promise<RunResult>((resolve) => {
      let reason: StopReason | null = null;
      let written = 0;
      let truncated = false;
      let program = firstWorker;
      let started = false; // the program has sent at least one message
      let waitingForInput = false;
      const input = createInputChannel();
      const finish = (result: RunResult) => {
        clock.stop();
        program.terminate(); // also ends a program asleep waiting for input
        this.active = null;
        this.setState("ready");
        resolve({ ...result, compileMs });
      };
      const stop = (why: StopReason) => {
        if (reason) return;
        reason = why;
        finish({ status: why, exitCode: null, ms: performance.now() - runStarted - clock.waitedMs, truncated });
      };
      const provideInput = (text: string | null) => {
        if (!waitingForInput || !input || reason) return;
        waitingForInput = false;
        sendInput(input, text);
        clock.resume();
      };
      const onMessage = ({ data }: MessageEvent<FromProgram>) => {
        started = true;
        if (reason) return;
        if (data.type === "out") {
          const room = opts.outputCap - written;
          const text = data.text.length > room ? data.text.slice(0, room) : data.text;
          written += text.length;
          if (text) opts.onOutput?.({ stream: data.stream, text });
          if (text.length < data.text.length) { truncated = true; stop("output-limit"); }
          return;
        }
        if (data.type === "input-request") {
          waitingForInput = true;
          clock.pause();
          opts.onInputRequest?.();
          return;
        }
        if (data.truncated) { truncated = true; return stop("output-limit"); }
        if (data.crash) opts.onOutput?.({ stream: "stderr", text: `\nProgram crashed: ${data.crash}\n` });
        finish({
          status: data.exitCode === 0 && !data.crash ? "ok" : "error",
          exitCode: data.crash ? null : data.exitCode,
          crash: data.crash,
          ms: data.ms,
          truncated,
        });
      };
      // The program is copied, not transferred, so it can be handed to a replacement worker
      // if the first one fails to start (see START_ATTEMPTS).
      const msg: ToProgram = { type: "run", wasm: outcome.wasm!, stdin: opts.stdin, outputCap: opts.outputCap, input };
      const launch = (worker: Worker, attempt: number) => {
        program = worker;
        worker.onmessage = onMessage;
        worker.onerror = (e) => {
          e.preventDefault(); // handled here: retried, or reported in the program's output
          if (reason) return;
          worker.terminate();
          if (!started && attempt < START_ATTEMPTS) return launch(this.createProgram(), attempt + 1);
          opts.onOutput?.({ stream: "stderr", text: `\nThe program could not run: ${e.message || "its worker failed to start"}\n` });
          finish({ status: "error", exitCode: null, ms: performance.now() - runStarted, truncated });
        };
        worker.postMessage(msg);
      };
      this.active = { stop, provideInput };
      const runStarted = performance.now();
      const clock = new RunClock(opts.timeoutMs, () => stop("timeout"));
      launch(firstWorker, 1);
    });
  }
}
