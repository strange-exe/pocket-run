// Messages between the main thread and a language worker.

export type Stream = "stdout" | "stderr";

/** "snapshot": restored from this device's saved memory snapshot; "fresh": a full start-up. */
export type BootSource = "snapshot" | "fresh";

export type ToWorker =
  | { type: "init"; interrupt: SharedArrayBuffer | null }
  | { type: "run"; code: string; stdin: string; filename: string };

export type FromWorker =
  | { type: "ready"; ms: number; source: BootSource }
  | { type: "boot-failed"; error: string }
  | { type: "out"; stream: Stream; text: string }
  | {
      type: "done";
      exitCode: number;
      /** The program stopped because we asked it to (KeyboardInterrupt). */
      interrupted: boolean;
      /** The runtime should be replaced, e.g. its heap grew after a MemoryError. */
      recycle: boolean;
      ms: number;
    };
