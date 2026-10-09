// Types for the parts of binji/wasm-clang's shared.js that Pocket Run uses.

export interface MemFS {
  ready: Promise<void>;
  addFile(path: string, contents: string | Uint8Array): void;
  getFileContents(path: string): Uint8Array;
}

export interface ApiOptions {
  readBuffer(name: string): Promise<ArrayBuffer>;
  compileStreaming(name: string): Promise<WebAssembly.Module>;
  hostWrite(text: string): void;
  clang?: string;
  lld?: string;
  memfs?: string;
  sysroot?: string;
}

export default class API {
  constructor(options: ApiOptions);
  ready: Promise<void>;
  memfs: MemFS;
  clangFilename: string;
  lldFilename: string;
  clangCommonArgs: string[];
  hostLog(message: string): void;
  hostLogAsync<T>(message: string, promise: Promise<T>): Promise<T>;
  getModule(name: string): Promise<WebAssembly.Module>;
  /** Runs a WASI tool against the shared memfs; rejects when it exits non-zero. */
  run(module: WebAssembly.Module, ...args: string[]): Promise<unknown>;
}
