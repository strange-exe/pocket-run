import { expect, test as base, type Page } from "@playwright/test";

/** Fails any test whose page logs a console error or throws an uncaught exception. */
export const test = base.extend<{ consoleErrors: string[] }>({
  consoleErrors: [
    async ({ page }, use) => {
      const errors: string[] = [];
      page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
      page.on("pageerror", (e) => errors.push(e.message));
      await use(errors);
      expect(errors, "console errors").toEqual([]);
    },
    { auto: true },
  ],
});
export { expect };

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
export async function showInput(page: Page) {
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
