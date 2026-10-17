// Messages between the main thread and a language worker.

export type Stream = "stdout" | "stderr";

/** "snapshot": restored from this device's saved memory snapshot; "fresh": a full start-up. */
export type BootSource = "snapshot" | "fresh";

export type ToWorker =
  | { type: "init"; interrupt: SharedArrayBuffer | null; input: SharedArrayBuffer | null }
  | { type: "run"; code: string; stdin: string; filename: string };

export type FromWorker =
  /** `note`: why a start-up was "fresh" (no snapshot yet, or the stored one couldn't be read or loaded). */
  | { type: "ready"; ms: number; source: BootSource; note?: string }
  | { type: "boot-failed"; error: string }
  | { type: "out"; stream: Stream; text: string }
  /** The program wants more input than the Input box had; it waits on the input channel. */
  | { type: "input-request" }
  | {
      type: "done";
      exitCode: number;
      /** The program stopped because we asked it to (KeyboardInterrupt). */
      interrupted: boolean;
      /** The runtime should be replaced, e.g. its heap grew after a MemoryError. */
      recycle: boolean;
      /** Run time, excluding time spent waiting for the student's input. */
      ms: number;
    };
