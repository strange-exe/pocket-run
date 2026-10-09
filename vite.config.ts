import { readdirSync, readFileSync } from "node:fs";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

const pyodideVersion: string = JSON.parse(readFileSync("node_modules/pyodide/package.json", "utf8")).version;

// Written by scripts/fetch-clang.mjs (runs before dev and build).
const clangDir = readdirSync("public/clang")[0];
const clangPack = JSON.parse(readFileSync(`public/clang/${clangDir}/manifest.json`, "utf8"));

// Cross-origin isolation enables SharedArrayBuffer, which lets us interrupt a
// running Python program instead of killing (and re-booting) the whole runtime.
const isolation = {
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Embedder-Policy": "require-corp",
};

export default defineConfig({
  server: { headers: isolation },
  preview: { headers: isolation },
  worker: { format: "es" },
  define: {
    __PYODIDE_VERSION__: JSON.stringify(pyodideVersion),
    __CLANG_PACK__: JSON.stringify(clangPack),
  },
  plugins: [
    VitePWA({
      registerType: "autoUpdate",
      manifest: {
        name: "Pocket Run",
        short_name: "Pocket Run",
        description: "Run Python, C and C++ files on your phone, even offline.",
        theme_color: "#F4F1EA",
        background_color: "#F4F1EA",
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
});
