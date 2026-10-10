// Messages for the C/C++ toolchain: a long-lived compiler worker (clang + lld) and a
// disposable runner worker that executes one compiled program.

export type CLang = "c" | "cpp";

export type ToCompiler =
  | { type: "check" }
  | { type: "download" }
  | { type: "boot" }
  | { type: "compile"; id: number; lang: CLang; code: string };

export type FromCompiler =
  | { type: "pack"; installed: boolean }
  | { type: "progress"; loaded: number; total: number }
  | { type: "download-failed"; error: string }
  | { type: "ready"; ms: number }
  | { type: "boot-failed"; error: string }
  | { type: "compiled"; id: number; ok: boolean; wasm?: Uint8Array; diagnostics: string; ms: number };

export type ToProgram = {
  type: "run";
  wasm: Uint8Array;
  stdin: string;
  outputCap: number;
  /** Live input channel (see input-channel.ts); null when the page isn't cross-origin isolated. */
  input: SharedArrayBuffer | null;
};

export type FromProgram =
  | { type: "out"; stream: "stdout" | "stderr"; text: string }
  | { type: "input-request" }
  | {
      type: "done";
      exitCode: number;
      /** Set when the program trapped (stack overflow, bad memory access, abort…). */
      crash?: string;
      truncated: boolean;
      /** Run time, excluding time spent waiting for the student's input. */
      ms: number;
    };
