import { existsSync, readdirSync, readFileSync } from "node:fs";
import { defineConfig, type Plugin } from "vite";
import { VitePWA } from "vite-plugin-pwa";

const pyodideVersion: string = JSON.parse(readFileSync("node_modules/pyodide/package.json", "utf8")).version;

/**
 * The C/C++ pack manifest, written by scripts/fetch-clang.mjs (npm's predev/prebuild run it).
 * Unit tests (Vitest, mode "test") never touch the pack, so they get a placeholder instead of
 * requiring a 20 MB download first. Dev and build fail with a clear message if it's missing.
 */
function clangPack(mode: string) {
  const dir = existsSync("public/clang") ? readdirSync("public/clang")[0] : undefined;
  if (dir) return JSON.parse(readFileSync(`public/clang/${dir}/manifest.json`, "utf8"));
  if (mode === "test") return { version: "test", source: "none", totalBytes: 0, files: {} };
  throw new Error("The C/C++ pack is missing: run `node scripts/fetch-clang.mjs` (npm run dev/build do this).");
}

/**
 * Inlines Phosphor icons into index.html at build time: `<i data-icon="play:fill"></i>` becomes that SVG.
 * No icon font or runtime script, so icons cost a few hundred bytes and work offline.
 */
function inlineIcons(): Plugin {
  const dir = "node_modules/@phosphor-icons/core/assets";
  return {
    name: "pocket-run:inline-icons",
    transformIndexHtml: (html) =>
      html.replace(/<i data-icon="([a-z-]+)(?::([a-z]+))?"><\/i>/g, (_, name: string, weight = "regular") => {
        const file = weight === "regular" ? `${dir}/regular/${name}.svg` : `${dir}/${weight}/${name}-${weight}.svg`;
        return readFileSync(file, "utf8")
          .trim()
          .replace("<svg ", `<svg class="icon icon-${name}" aria-hidden="true" focusable="false" `);
      }),
  };
}

// Cross-origin isolation enables SharedArrayBuffer, which lets us interrupt a
// running Python program instead of killing (and re-booting) the whole runtime.
const isolation = {
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Embedder-Policy": "require-corp",
};

// Content-Security-Policy: a second line of defence behind the Python sandbox (src/workers/lockdown.ts).
// Everything comes from this site; WebAssembly may compile ('wasm-unsafe-eval') but eval() and
// new Function() may not; no plugins, framing or <base> tricks. Workers loaded from a URL take this
// policy from their own response, so the same header covers the page and every worker.
// 'unsafe-inline' for styles only: CodeMirror injects its stylesheet at run time.
const csp = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  "worker-src 'self'",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

/** Every response's security headers. Also written to dist/_headers for Cloudflare Pages. */
const securityHeaders = {
  ...isolation,
  "Content-Security-Policy": csp,
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
};

/** Writes Cloudflare Pages' _headers file from securityHeaders, so the two can't drift apart. */
function pagesHeaders(): Plugin {
  return {
    name: "pocket-run:pages-headers",
    apply: "build",
    generateBundle() {
      const lines = Object.entries(securityHeaders).map(([name, value]) => `  ${name}: ${value}`);
      this.emitFile({ type: "asset", fileName: "_headers", source: `/*\n${lines.join("\n")}\n` });
    },
  };
}

export default defineConfig(({ mode }) => ({
  // The CSP is enforced on the production build: `vite preview` (which the end-to-end tests use)
  // sends exactly what Cloudflare sends. The dev server keeps only the isolation headers.
  server: { headers: isolation },
  preview: { headers: securityHeaders },
  worker: { format: "es" },
  define: {
    __PYODIDE_VERSION__: JSON.stringify(pyodideVersion),
    __CLANG_PACK__: JSON.stringify(clangPack(mode)),
  },
  plugins: [
    inlineIcons(),
    pagesHeaders(),
    VitePWA({
      registerType: "autoUpdate",
      manifest: {
        name: "Pocket Run",
        short_name: "Pocket Run",
        description: "Run Python, C and C++ files on your phone, even offline.",
        theme_color: "#0B0E13",
        background_color: "#0B0E13",
        display: "standalone",
        start_url: "/",
        icons: [
          { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
          { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: {
        // The Python runtime is precached so the first visit makes the app work offline.
        globPatterns: ["**/*.{js,mjs,css,html,svg,png,woff2,wasm,zip,json}"],
        // The C/C++ pack (~20 MB) is opt-in: the compiler worker downloads it into its own cache.
        globIgnores: ["clang/**"],
        maximumFileSizeToCacheInBytes: 12 * 1024 * 1024,
        // Versioned or hashed URLs need no ?__WB_REVISION__ cache-buster, so installing the
        // service worker can reuse what the page already downloaded (no second 6 MB download).
        dontCacheBustURLsMatching: /^(assets|pyodide\/\d+\.\d+\.\d+)\//,
        navigateFallback: "/index.html",
      },
    }),
  ],
}));
