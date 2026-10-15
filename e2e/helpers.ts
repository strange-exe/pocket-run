import { expect, test as base, type Page } from "@playwright/test";

/**
 * WebKit blocks the first worker created after any reload, then logs these itself. The app retries
 * and recovers (see START_ATTEMPTS in src/runner/runner.ts and the reload tests), so these exact
 * messages are tolerated in WebKit only.
 */
const WEBKIT_RECOVERED_WORKER_BLOCK = [
  /^Refused to load '[^']+\/assets\/[\w-]+\.js' worker because of Cross-Origin-Embedder-Policy\.$/,
  /^Worker load was blocked by Cross-Origin-Embedder-Policy$/,
  /^Failed to load resource: Worker load was blocked by Cross-Origin-Embedder-Policy$/,
  // Not end-anchored: WebKit's text can carry trailing whitespace, which a bare `$` rejects.
  /\/assets\/[\w-]+\.js due to access control checks/,
  /\/pyodide\/[\d.]+-heap\d+\/pyodide\.mjs due to access control checks/,
  // A reload or a navigation while the app is still registering its service worker cancels the sw.js download,
  // and WebKit logs the cancelled request this way (seen on CI in three different tests, 2026-10-12 to 10-15).
  // Harmless: registration simply happens on the next load. A real service worker failure can't hide here, because
  // offline.spec.ts and the other offline tests check that the app really works with no network.
  /^\/[\w.:]+\/sw\.js due to access control checks\.?\s*$/,
];

/**
 * Fails any test whose page logs a console error or throws an uncaught exception. A test can
 * declare extra, specific noise it expects with `test.use(tolerating(/.../, /.../))`.
 */
export const test = base.extend<{ consoleErrors: string[]; tolerate: RegExp[] }>({
  tolerate: [[], { option: true }],
  consoleErrors: [
    async ({ page, tolerate }, use, testInfo) => {
      const errors: string[] = [];
      const tolerated = (text: string) =>
        tolerate.some((re) => re.test(text)) ||
        (testInfo.project.name === "webkit" && WEBKIT_RECOVERED_WORKER_BLOCK.some((re) => re.test(text)));
      page.on("console", (m) => { if (m.type() === "error" && !tolerated(m.text())) errors.push(m.text()); });
      // WebKit also reports the blocked worker load as a page error (no stack; Playwright splits
      // "Cannot load http://…" at the colon into name and message), so the same list applies.
      page.on("pageerror", (e) => { if (!tolerated(e.message) && !tolerated(`${e.name}:${e.message}`)) errors.push(e.message); });
      await use(errors);
      expect(errors, "console errors").toEqual([]);
    },
    { auto: true },
  ],
});
export { expect };

/**
 * Options for test.use() that tolerate these messages. Playwright reads an array given to test.use()
 * as its own [value, options] tuple, so `{ tolerate: [a, b] }` would arrive as just `a` (measured).
 */
export const tolerating = (...patterns: RegExp[]) => ({ tolerate: [patterns, { scope: "test" }] as unknown as RegExp[] });

/**
 * Chooses "Pocket Run (match device)" before any page loads, as if picked in the theme dialog, so
 * the emulated light/dark setting decides the colours. The default theme (Tokyo Night) is always dark.
 */
export async function followDeviceTheme(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem("pocket-run:theme", "system");
    localStorage.setItem("pocket-run:theme-paint", JSON.stringify({ system: true, scheme: "light", colors: null }));
  });
}

export async function openApp(page: Page) {
  await page.goto("/");
  // Wait on state, not wording: loading messages can contain the word "ready" too.
  await expect(page.locator("#status-dot")).toHaveAttribute("data-state", "ready", { timeout: 30_000 });
}

/** Loads code through the real Open button's file input, like a student would. */
export async function openFile(page: Page, name: string, code: string) {
  await page.locator("#file-input").setInputFiles({ name, mimeType: "text/plain", buffer: Buffer.from(code) });
  await expect(page.locator("#filename")).toHaveValue(name);
}

export interface Ran { status: string | null; receipt: string; output: string }

/** Expands the Input section if needed. (`open` is a boolean attribute: its value is "" when set.) */
/** Phones show Code and Output as tabs: switches to one, like a student tapping it (no-op on wider screens). */
export async function showView(page: Page, view: "code" | "output") {
  const tab = page.locator(`#tab-${view}`);
  if (await tab.isVisible()) await tab.click();
}

export async function showInput(page: Page) {
  await showView(page, "output"); // on phones the Input box is in the Output tab
  const box = page.locator("#stdin-box");
  if (!(await box.evaluate((d: HTMLDetailsElement) => d.open))) await box.locator("summary").click();
}

export async function run(page: Page, name: string, code: string, stdin = ""): Promise<Ran> {
  await openFile(page, name, code);
  await showInput(page);
  await page.locator("#stdin").fill(stdin);
  await page.locator("#run-btn").click();
  await expect(page.locator("#run-label")).toHaveText("Run", { timeout: 20_000 });
  return {
    status: await page.locator("#receipt").getAttribute("data-status"),
    receipt: (await page.locator("#receipt").textContent()) ?? "",
    output: (await page.locator("#output").textContent()) ?? "",
  };
}
