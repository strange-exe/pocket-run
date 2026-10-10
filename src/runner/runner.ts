import { createInputChannel, sendInput } from "./input-channel";
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
  /**
   * The program needs more input than the Input box held. The runner pauses its time limit
   * until the page calls provideInput(line) or provideInput(null) for end of input.
   */
  onInputRequest?: () => void;
}

/**
 * The time limit counts only the program's own time: it pauses while the program waits for
 * the student to type, and resumes when the line arrives.
 */
export class RunClock {
  private budget: number;
  private segmentStart = performance.now();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private waitStart = 0;
  waitedMs = 0;

  constructor(limitMs: number, private readonly onExpire: () => void) {
    this.budget = limitMs;
    this.timer = setTimeout(onExpire, limitMs);
  }
  pause() {
    clearTimeout(this.timer);
    this.budget -= performance.now() - this.segmentStart;
    this.waitStart = performance.now();
  }
  resume() {
    this.waitedMs += performance.now() - this.waitStart;
    this.segmentStart = performance.now();
    this.timer = setTimeout(this.onExpire, Math.max(0, this.budget));
  }
  stop() { clearTimeout(this.timer); }
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
 * Starting a worker can fail spuriously: WebKit blocks workers created right after a reload
 * that interrupted the previous page's start-up ("Worker load was blocked by
 * Cross-Origin-Embedder-Policy"), while a new attempt moments later succeeds. Retry before
 * telling the student the runtime couldn't start.
 */
export const START_ATTEMPTS = 3;

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
  private input: SharedArrayBuffer | null = null;
  private active: { stop: (reason: StopReason) => void; provideInput?: (text: string | null) => void } | null = null;

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
    this.ready = (async () => {
      for (let attempt = 1; ; attempt++) {
        try {
          await this.startWorker();
          this.setState("ready");
          return;
        } catch (e) {
          if (attempt >= START_ATTEMPTS) {
            this.bootError = (e as Error).message;
            this.setState("failed");
            throw e;
          }
          await new Promise((r) => setTimeout(r, 250 * attempt));
        }
      }
    })();
    this.ready.catch(() => {}); // surfaced through state; run() rethrows
  }

  /** One attempt to start the runtime; rejects (and discards the worker) if it can't start. */
  private startWorker(): Promise<void> {
    const worker = this.createWorker();
    this.worker = worker;
    this.interrupt = self.crossOriginIsolated ? new SharedArrayBuffer(1) : null;
    const started = new Promise<void>((resolve, reject) => {
      // Both listeners only cover start-up; they are removed as soon as it succeeds or fails.
      const detach = () => {
        worker.removeEventListener("message", onMessage);
        worker.removeEventListener("error", onError);
      };
      const fail = (message: string) => {
        detach();
        worker.terminate();
        reject(new Error(message));
      };
      const onError = (e: ErrorEvent) => {
        e.preventDefault(); // handled here (we retry); otherwise browsers also report it as uncaught
        fail(e.message || "the runtime failed to start");
      };
      const onMessage = ({ data }: MessageEvent<FromWorker>) => {
        if (data.type !== "ready" && data.type !== "boot-failed") return;
        if (data.type === "boot-failed") return fail(data.error);
        detach();
        this.lastBoot = { source: data.source, ms: data.ms };
        resolve();
      };
      worker.addEventListener("message", onMessage);
      worker.addEventListener("error", onError);
    });
    this.input = createInputChannel();
    this.send({ type: "init", interrupt: this.interrupt, input: this.input });
    return started;
  }

  private restart() {
    this.worker.terminate();
    this.boot();
  }

  /** Ask the running program to stop (user pressed Stop). */
  stop() {
    this.active?.stop("stopped");
  }

  /** Answers the program's request for input: a line (with "\n") or null for end of input. */
  provideInput(text: string | null) {
    this.active?.provideInput?.(text);
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
      const input = this.input;
      let written = 0;
      let truncated = false;
      let reason: StopReason | null = null;
      let hardKill: ReturnType<typeof setTimeout> | undefined;
      let waitingForInput = false;

      const finish = (result: RunResult, recycle: boolean) => {
        clock.stop();
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
        // A program asleep waiting for input can't see the interrupt: wake it with end of input.
        if (waitingForInput && input) { waitingForInput = false; sendInput(input, null); }
        hardKill = setTimeout(() => {
          finish({ status: why, exitCode: null, ms: performance.now() - started - clock.waitedMs, truncated }, true);
        }, interrupt ? GRACE_MS : 0);
      };

      const provideInput = (text: string | null) => {
        if (!waitingForInput || !input || reason) return;
        waitingForInput = false;
        sendInput(input, text);
        clock.resume();
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
        } else if (data.type === "input-request") {
          if (reason || !input) return;
          waitingForInput = true;
          clock.pause();
          opts.onInputRequest?.();
        } else if (data.type === "done") {
          const status: RunStatus = reason ?? (data.exitCode === 0 ? "ok" : "error");
          finish({ status, exitCode: data.exitCode, ms: data.ms, truncated }, data.recycle);
        }
      };

      const clock = new RunClock(opts.timeoutMs, () => stop("timeout"));
      this.active = { stop, provideInput };
      worker.addEventListener("message", onMessage);
      this.send({ type: "run", code: opts.code, stdin: opts.stdin, filename: opts.filename });
    });
  }
}
