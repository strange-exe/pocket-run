import type { BootSource, FromWorker, Stream, ToWorker } from "./protocol";

export type RunnerState = "booting" | "ready" | "running" | "failed";
export type RunStatus = "ok" | "error" | "compile-error" | "timeout" | "stopped" | "output-limit";

export interface OutputChunk { stream: Stream; text: string }

export interface RunOptions {
  code: string;
  stdin: string;
  filename: string;
  timeoutMs: number;
  outputCap: number;
  onOutput?: (chunk: OutputChunk) => void;
  /** Compiled languages report which step a run is in, for the progress line. */
  onPhase?: (phase: "starting" | "compiling" | "running") => void;
}

export interface RunResult {
  status: RunStatus;
  /** null when the runtime had to be killed. */
  exitCode: number | null;
  ms: number;
  truncated: boolean;
  /** How a compiled program crashed (stack overflow, bad memory access…), when it did. */
  crash?: string;
  /** Time spent compiling (C/C++ only). */
  compileMs?: number;
  /** For timeouts and stops in compiled languages: whether it happened while compiling. */
  stage?: "compile" | "run";
}

export type StopReason = Exclude<RunStatus, "ok" | "error" | "compile-error">;

/** After a soft interrupt, how long the program gets to unwind before a hard kill. */
const GRACE_MS = 1000;

/**
 * Drives one language worker. Stopping a program escalates: first a
 * KeyboardInterrupt through a SharedArrayBuffer (keeps the warm runtime), then
 * worker.terminate() plus a fresh boot when the program does not yield.
 */
export class Runner {
  state: RunnerState = "booting";
  bootError = "";
  /** How the current runtime started, and how long it took (for diagnostics and tests). */
  lastBoot: { source: BootSource; ms: number } | null = null;
  onState?: (state: RunnerState) => void;

  private worker!: Worker;
  private interrupt: SharedArrayBuffer | null = null;
  private ready!: Promise<void>;
  private active: { stop: (reason: StopReason) => void } | null = null;

  constructor(private readonly createWorker: () => Worker) {
    this.boot();
  }

  private setState(state: RunnerState) {
    this.state = state;
    this.onState?.(state);
  }

  private send(msg: ToWorker) {
    this.worker.postMessage(msg);
  }

  private boot() {
    this.setState("booting");
    this.worker = this.createWorker();
    this.interrupt = self.crossOriginIsolated ? new SharedArrayBuffer(1) : null;
    const worker = this.worker;
    this.ready = new Promise((resolve, reject) => {
      const onMessage = ({ data }: MessageEvent<FromWorker>) => {
        if (data.type !== "ready" && data.type !== "boot-failed") return;
        worker.removeEventListener("message", onMessage);
        if (data.type === "ready") {
          this.lastBoot = { source: data.source, ms: data.ms };
          this.setState("ready");
          resolve();
        } else {
          this.bootError = data.error;
          this.setState("failed");
          reject(new Error(data.error));
        }
      };
      worker.addEventListener("message", onMessage);
      worker.addEventListener("error", (e) => {
        this.bootError = e.message || "the runtime failed to start";
        this.setState("failed");
        reject(new Error(this.bootError));
      }, { once: true });
    });
    this.ready.catch(() => {}); // surfaced through state; run() rethrows
    this.send({ type: "init", interrupt: this.interrupt });
  }

  private restart() {
    this.worker.terminate();
    this.boot();
  }

  /** Ask the running program to stop (user pressed Stop). */
  stop() {
    this.active?.stop("stopped");
  }

  async run(opts: RunOptions): Promise<RunResult> {
    if (this.active) throw new Error("a program is already running");

    // A run pressed while the runtime is still starting waits for it, and must be
    // cancellable during that wait too. The time limit only starts once it executes.
    let cancel!: () => void;
    const cancelled = new Promise<"cancelled">((resolve) => { cancel = () => resolve("cancelled"); });
    this.active = { stop: cancel };
    let waited: "ready" | "cancelled";
    try {
      waited = await Promise.race([this.ready.then(() => "ready" as const), cancelled]);
    } catch (e) {
      this.active = null;
      throw e;
    }
    if (waited === "cancelled") {
      this.active = null;
      return { status: "stopped", exitCode: null, ms: 0, truncated: false };
    }
    this.setState("running");

    return new Promise<RunResult>((resolve) => {
      const started = performance.now();
      const worker = this.worker;
      const interrupt = this.interrupt;
      let written = 0;
      let truncated = false;
      let reason: StopReason | null = null;
      let hardKill: ReturnType<typeof setTimeout> | undefined;

      const finish = (result: RunResult, recycle: boolean) => {
        clearTimeout(timer);
        clearTimeout(hardKill);
        worker.removeEventListener("message", onMessage);
        this.active = null;
        if (interrupt) Atomics.store(new Uint8Array(interrupt), 0, 0);
        if (recycle) this.restart();
        else this.setState("ready");
        resolve(result);
      };

      const stop = (why: StopReason) => {
        if (reason) return;
        reason = why;
        if (interrupt) Atomics.store(new Uint8Array(interrupt), 0, 2); // SIGINT
        hardKill = setTimeout(() => {
          finish({ status: why, exitCode: null, ms: performance.now() - started, truncated }, true);
        }, interrupt ? GRACE_MS : 0);
      };

      const onMessage = ({ data }: MessageEvent<FromWorker>) => {
        if (data.type === "out") {
          if (truncated) return;
          const room = opts.outputCap - written;
          const text = data.text.length > room ? data.text.slice(0, room) : data.text;
          written += text.length;
          if (text) opts.onOutput?.({ stream: data.stream, text });
          if (text.length < data.text.length) {
            truncated = true;
            stop("output-limit");
          }
        } else if (data.type === "done") {
          const status: RunStatus = reason ?? (data.exitCode === 0 ? "ok" : "error");
          finish({ status, exitCode: data.exitCode, ms: data.ms, truncated }, data.recycle);
        }
      };

      const timer = setTimeout(() => stop("timeout"), opts.timeoutMs);
      this.active = { stop };
      worker.addEventListener("message", onMessage);
      this.send({ type: "run", code: opts.code, stdin: opts.stdin, filename: opts.filename });
    });
  }
}
