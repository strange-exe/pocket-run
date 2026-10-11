import { defineConfig, devices } from "@playwright/test";

const PORT = 4317;
// One explicit address: on Windows `vite preview` listens on [::1] only, and Firefox now and then
// tried 127.0.0.1 for "localhost" and got "connection refused" mid-run.
const ORIGIN = `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: "e2e",
  timeout: 45_000,
  fullyParallel: false,
  workers: 1,
  // On CI, failures also become GitHub annotations: readable on the run page and through the public
  // API without signing in to view the full log.
  reporter: process.env.CI ? [["github"], ["list"]] : [["list"]],
  use: { baseURL: ORIGIN },
  // The same suite in all three engines. WebKit is the engine inside Safari; Playwright's build
  // is closest to real Safari on macOS, so a Mac (or an iPhone) is still the final check.
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "firefox", use: { ...devices["Desktop Firefox"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
  ],
  // Tests run against the production build: the service worker and precache only exist there.
  webServer: {
    command: `npm run build && npx vite preview --host 127.0.0.1 --port ${PORT} --strictPort`,
    url: ORIGIN,
    reuseExistingServer: false,
    timeout: 180_000,
  },
});
