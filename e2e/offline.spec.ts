import { expect, openApp, run, test } from "./helpers";

test("after one visit, the app loads and runs Python with no network", async ({ page, context }) => {
  await openApp(page);
  // The service worker finishes precaching the Python runtime in the background.
  await expect(page.locator("#status-text")).toContainText("works offline", { timeout: 60_000 });

  await context.setOffline(true);
  await page.reload();
  await expect(page.locator("#status-text")).toContainText("Python ready", { timeout: 30_000 });
  const r = await run(page, "main.py", 'print(sum(range(10)))');
  expect(r.status).toBe("ok");
  expect(r.output).toBe("45\n");
  expect(await page.evaluate(() => self.crossOriginIsolated)).toBe(true);
});
