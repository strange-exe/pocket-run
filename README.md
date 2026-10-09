# Pocket Run

Run a single Python, C or C++ file on your phone, even with no internet.

Pocket Run is for students who need to check a program's output quickly, on a phone, on a weak connection.
Everything runs **inside the browser**: there is no server that executes code, so after the first visit the app
works offline and a runaway program can only ever affect its own browser tab.

| Language | Runtime | Download | Offline |
|---|---|---|---|
| Python 3.14 | Pyodide 314.0.7 | ~6 MB, on the first visit | ✅ |
| C (gnu11), C++17 | clang 8 + lld in WebAssembly ([binji/wasm-clang]) | ~20 MB, once, when you first run a C/C++ file | ✅ |

[binji/wasm-clang]: https://github.com/binji/wasm-clang

## Using it

1. **Open** a `.py`, `.c` or `.cpp` file from your device, or type in the editor. The language comes from the file
   extension (`.py`, `.c`, `.cpp` / `.cc` / `.cxx`).
2. Put anything the program reads (`input()`, `scanf`, `cin`) in **Input**, one value per line.
3. Press **Run** (or <kbd>Ctrl</kbd>/<kbd>⌘</kbd> + <kbd>Enter</kbd>). Output appears on the printout below.
   The first time you run C or C++, Pocket Run offers the one-time compiler download.
4. **Save** downloads the file back to your device with the same name.

Your current file is kept on the device between visits.

### Limits

- Programs stop after **8 seconds** and after **64 KB** of output. **Stop** ends a run at any time.
- Input is read from the Input box, not typed live while the program runs.
- One file at a time, up to 512 KB. Standard library only (no `pip install`, no extra C libraries).
- C/C++: programs may use up to 256 MB of memory. **C++ exceptions (`try` / `throw`) are not supported** by this
  toolchain, and its C++ library is libc++ 8 (C++17 language; no `<filesystem>`). `#include <bits/stdc++.h>` works.

## How it works

```
                 ┌──► python.worker     Pyodide: one warm interpreter, fresh globals per run
main thread ─────┤
  editor, files  ├──► clang.worker      clang + lld, kept warm: source → WASI program
  time limit,    │
  output cap     └──► c-runner.worker   runs one compiled program, then is thrown away
```

- **Stopping a program.** Python gets a `KeyboardInterrupt` through a `SharedArrayBuffer`, which keeps the warm
  interpreter. If it doesn't yield within a second (for example, a long loop in C code), the worker is replaced.
  A C/C++ program runs in its own small worker, so stopping it never reloads the compiler. Interrupts need
  cross-origin isolation, which `public/_headers` turns on.
- **Offline.** A Workbox service worker precaches the app and the Python runtime. It registers only after Python is
  ready, so its install reuses the files the page just downloaded instead of fetching them again. The C/C++ pack is
  opt-in: the compiler worker downloads it, checks every file's SHA-256, and keeps it in its own cache.
- **Fast restarts.** After the first start, the Python worker saves a memory snapshot of the started interpreter on
  the device. Later visits restore it, which cut Python's start-up from 3.1 s to about 0.6 s on an Android emulator.
  A missing, corrupt or outdated snapshot falls back to a normal start.
- **Containment.** Infinite loops hit the time limit. Memory bombs raise `MemoryError` (Python) or hit the 256 MB cap
  (C/C++). Deep recursion raises `RecursionError` or is reported as a stack overflow, bad pointers as an invalid memory
  access, and output floods are cut at the cap. These cases are covered by the end-to-end tests.

## Development

Requires Node.js 20.19+ or 22.12+.

```bash
npm install
npm run dev          # http://localhost:5173
npm test             # unit tests (Vitest)
npx playwright install chromium
npm run e2e          # builds, serves the production build, runs browser tests
npm run build        # typecheck + production build into dist/
```

Before `dev` and `build`, two scripts prepare the runtimes in `public/` (git-ignored):
`scripts/copy-pyodide.mjs` copies Pyodide from `node_modules/pyodide` into `public/pyodide/<version>/`, and
`scripts/fetch-clang.mjs` downloads the C/C++ toolchain at a pinned commit, verifies its SHA-256 hashes, and writes the
gzipped pack to `public/clang/<commit>/`.

## Deploying

The site is static. On Cloudflare Pages, use build command `npm run build` and output directory `dist`.
`public/_headers` sets the cross-origin isolation headers. Cloudflare Pages limits each file to 25 MiB: clang is
29.8 MiB uncompressed, so it ships gzipped (10.6 MB) and is decompressed on the device.

## License

MIT. See [LICENSE](LICENSE).

## Third-party software

- [Pyodide](https://pyodide.org/): Mozilla Public License 2.0.
- [binji/wasm-clang](https://github.com/binji/wasm-clang): Apache License 2.0. `src/vendor/wasm-clang/shared.js` is
  vendored from it (turned into an ES module; see the note at the end of the file and `src/vendor/wasm-clang/LICENSE`).
- LLVM / clang / lld binaries: Apache License 2.0 with LLVM Exceptions, plus the University of Illinois/NCSA licence
  for code from before LLVM's relicensing. Both texts ship with the pack as `LICENSE.llvm.txt`.
- Fonts: Bricolage Grotesque and JetBrains Mono (SIL Open Font License 1.1).
