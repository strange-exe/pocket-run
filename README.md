# Pocket Run

Run a single Python, C or C++ file on your phone, even with no internet.

Pocket Run is for students who need to check a program's output quickly, on a phone, on a weak connection.
Everything runs **inside the browser**: there is no server that executes code, so after the first visit the app
works offline and a runaway program can only ever affect its own browser tab.
New here? [pocket-run.pages.dev/about/](https://pocket-run.pages.dev/about/) explains it in a minute.

| Language | Runtime | Download | Offline |
|---|---|---|---|
| Python 3.14 | Pyodide 314.0.7 | ~6 MB, on the first visit | ✅ |
| C (gnu11), C++17 | clang 8 + lld in WebAssembly ([binji/wasm-clang]) | ~20 MB, once, when you first run a C/C++ file | ✅ |

[binji/wasm-clang]: https://github.com/binji/wasm-clang

## Using it

1. **Open** a `.py`, `.c` or `.cpp` file from your device, or type in the editor. The language comes from the file
   extension (`.py`, `.c`, `.cpp` / `.cc` / `.cxx`).
2. Press **Run** (or <kbd>Ctrl</kbd>/<kbd>⌘</kbd> + <kbd>Enter</kbd>). Output appears in the Output panel.
   The first time you run C or C++, Pocket Run offers the one-time compiler download.
3. When the program reads input (`input()`, `scanf`, `cin`), Pocket Run asks for it while the program runs, like a
   terminal. **End input** (or <kbd>Ctrl</kbd> + <kbd>D</kbd>) sends end-of-file. You can also put values in the
   **Input** box up front; the program reads those first and only asks for anything beyond them.
4. **Save** downloads the file back to your device with the same name. **Share** creates a link that opens the file
   (with its name and Input) in anyone's Pocket Run. The file travels inside the link's `#` part, which browsers never
   send to a server, and opening a link never runs the code.

Your current file is kept on the device between visits. On phones, a bar of hard-to-reach symbols
(`{ } [ ] ( ) ; " < > \ …`, Tab and cursor keys) sits above the keyboard while you edit code.

**Colour themes** (the palette button at the top): Pocket Run's own light, dark and high-contrast themes, plus
popular editor themes (GitHub-style, One Dark Pro, Dracula, Tokyo Night, Catppuccin). You can also load your own:
**Get template** saves the current colours as a small JSON file; change the `#rrggbb` values and load it back. Themes
are kept on the device, and any colour too faint to read is darkened or lightened (keeping its hue) until it meets
WCAG AA contrast.

### Safety

Files never leave the device: Open reads the file in the page, and a share link carries it in the URL's `#` part.
Anything that arrives from outside is checked first:

- **Opened files and share links** must be Python, C or C++ text up to 512 KB. Programs, archives, documents and
  images renamed to `.py`/`.c`/`.cpp` are refused, as are invalid UTF-8 and control characters.
- **Hidden text tricks** are blocked: the direction-control characters of "Trojan Source" attacks (CVE-2021-42574),
  which make code display differently from how it runs. Invisible characters are shown as red dots, explained, and
  can be removed in one tap; files containing them can't be shared until they are.
- **Share links** that unpack to more than a code file's worth of data are stopped while unpacking.
- **File names** lose path parts, direction tricks and reserved names (a name with a right-to-left override, shown as `mainexe.py`, is really `main<RLO>yp.exe` and is cleaned to `mainyp.exe`).
- **Theme files** may only contain `#rrggbb` colours for known names: no CSS, URLs or script.
- **Running code** is sandboxed: before student code runs, the Python worker removes its access to the site's
  storage (where the offline app itself is cached), the network and new workers, so a shared program can't tamper
  with the app. C/C++ programs run as WebAssembly with only a minimal WASI interface.
- **Content-Security-Policy** on every response, the page and each worker: scripts and connections only from the
  site itself, WebAssembly allowed but no `eval()` or `new Function()` (so Pyodide's `run_js` is refused too), no
  plugins, framing or `<base>` tricks.

### Limits

- Programs stop after **8 seconds** of running and after **64 KB** of output. Time spent waiting for you to type
  doesn't count. **Stop** ends a run at any time.
- One file at a time, up to 512 KB. Standard library only (no `pip install`, no extra C libraries).
- C/C++: programs may use up to 256 MB of memory. **C++ exceptions (`try` / `throw`) are not supported** by this
  toolchain, and its C++ library is libc++ 8 (C++17 language; no `<filesystem>`). `#include <bits/stdc++.h>` works.

### Browser support

The same web app runs on desktop and on phones. The end-to-end suite runs in **Chromium, Firefox and WebKit**
(the engine behind Safari) through Playwright, and `e2e/android-check.mjs` covers Chrome on Android. Playwright's
WebKit is close to Safari but not identical; real Safari on a Mac or iPhone has not been tested yet.

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
  cross-origin isolation, which the response headers turn on (see below).
- **Offline.** A Workbox service worker precaches the app and the Python runtime. It registers only after Python is
  ready, so its install reuses the files the page just downloaded instead of fetching them again. The C/C++ pack is
  opt-in: the compiler worker downloads it, checks every file's SHA-256, and keeps it in its own cache.
- **Fast restarts.** After the first start, the Python worker saves a memory snapshot of the started interpreter on
  the device. Later visits restore it, which cut Python's start-up from 3.1 s to about 0.6 s on an Android emulator.
  A missing, corrupt or outdated snapshot falls back to a normal start.
- **Faster `<bits/stdc++.h>`.** The first compile that includes it also builds a precompiled header and keeps it on
  the device. Later compiles reuse it: on an Android emulator, 2.2–2.7 s became 0.65–0.97 s. Files that don't include
  `<bits/stdc++.h>` never see it, and a damaged cached copy is dropped and rebuilt.
- **Live input.** A program reads stdin synchronously inside its worker, so it can't wait for a browser event. When it
  needs more input, the worker marks a `SharedArrayBuffer` channel as waiting, asks the page, and sleeps in
  `Atomics.wait` until the page writes the typed line into shared memory (`src/runner/input-channel.ts`). The time
  limit pauses meanwhile. C programs are linked with a tiny start-up object that makes `stdout` unbuffered, so a
  `printf("Enter n: ")` prompt is visible before `scanf` waits.
- **Containment.** Infinite loops hit the time limit. Memory bombs raise `MemoryError` (Python) or hit the 256 MB cap
  (C/C++). Deep recursion raises `RecursionError` or is reported as a stack overflow, bad pointers as an invalid memory
  access, and output floods are cut at the cap. These cases are covered by the end-to-end tests.

## Development

Requires Node.js 20.19+ or 22.12+.

```bash
npm install
npm run dev          # http://localhost:5173
npm test             # unit tests (Vitest)
npx playwright install chromium firefox webkit
npm run e2e          # builds, serves the production build, runs browser tests in all three
npm run build        # typecheck + production build into dist/
```

Before `dev` and `build`, two scripts prepare the runtimes in `public/` (git-ignored):
`scripts/copy-pyodide.mjs` copies Pyodide from `node_modules/pyodide` into `public/pyodide/<version>/`, and
`scripts/fetch-clang.mjs` downloads the C/C++ toolchain at a pinned commit, verifies its SHA-256 hashes, and writes the
gzipped pack to `public/clang/<commit>/`.

The about page (`about/index.html`, `src/about.css`) is static and shares the app's tokens and themes
(`src/tokens.css`). Its phone screenshots are rendered from the real app: run `npm run build`, then
`node scripts/make-about-shots.mjs` after a visible UI change.

### Testing on Android (emulator or USB device)

```bash
adb reverse tcp:4318 tcp:4318
npx vite preview --host 127.0.0.1 --port 4318
node e2e/android-check.mjs online
```

`adb reverse` makes the device's `localhost:4318` reach your computer, and `localhost` is a secure context, which
service workers need. Stop the preview server and run `node e2e/android-check.mjs offline` to check the app loads
from the device's cache. The script talks to Chrome through its DevTools socket, so Chrome needs no flags.

## Continuous integration and deploying

Every push and pull request runs the unit tests and the end-to-end suite in Chromium, Firefox and WebKit
(`.github/workflows/ci.yml`, one parallel job per browser).

The site is static and deploys through Cloudflare Pages' Git integration: build command `npm run build`, output
directory `dist`, Node version from `.node-version`. The build writes `dist/_headers` from `securityHeaders` in `vite.config.ts`: cross-origin isolation plus a strict Content-Security-Policy (scripts and connections only from the site itself, WebAssembly allowed, no `eval`). Cloudflare Pages limits each file to 25 MiB: clang is
29.8 MiB uncompressed, so it ships gzipped (10.6 MB) and is decompressed on the device.

## License

MIT. See [LICENSE](LICENSE).

## Third-party software

- [Pyodide](https://pyodide.org/): Mozilla Public License 2.0.
- [binji/wasm-clang](https://github.com/binji/wasm-clang): Apache License 2.0. `src/vendor/wasm-clang/shared.js` is
  vendored from it (turned into an ES module; see the note at the end of the file and `src/vendor/wasm-clang/LICENSE`).
- LLVM / clang / lld binaries: Apache License 2.0 with LLVM Exceptions, plus the University of Illinois/NCSA licence
  for code from before LLVM's relicensing. Both texts ship with the pack as `LICENSE.llvm.txt`.
- Fonts: Geist and JetBrains Mono (SIL Open Font License 1.1).
- Icons: Phosphor Icons (MIT).
- Theme palettes (colour values only, in `src/themes.ts`): [Catppuccin](https://github.com/catppuccin/palette) (MIT),
  [Dracula](https://draculatheme.com/) (MIT), [Tokyo Night](https://github.com/folke/tokyonight.nvim) by folke
  (Apache License 2.0), [One Dark Pro](https://github.com/Binaryify/OneDark-Pro) (MIT), and the
  [GitHub VS Code theme](https://github.com/primer/github-vscode-theme) (MIT). "GitHub" is a trademark of GitHub, Inc.;
  the theme is labelled "GitHub-style" and is not affiliated with or endorsed by GitHub.
