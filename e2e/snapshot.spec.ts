import type { Page } from "@playwright/test";
import { expect, openApp, run, test } from "./helpers";

const CACHE = "pocket-run-python-snapshot";

/** Resolves once the worker has stored this device's snapshot (it saves after "ready"). */
async function waitForSnapshot(page: Page) {
  await expect.poll(() => page.evaluate(async (name) => (await (await caches.open(name)).keys()).length, CACHE),
    { timeout: 15_000 }).toBe(1);
}

test("the second start restores Python from the device's snapshot", async ({ page }) => {
  await openApp(page);
  const dot = page.locator("#status-dot");
  await expect(dot).toHaveAttribute("data-boot", "fresh");
  await expect(dot).toHaveAttribute("data-boot-note", "no snapshot stored yet");
  await waitForSnapshot(page);

  await page.reload();
  await expect(dot).toHaveAttribute("data-state", "ready", { timeout: 30_000 });
  // If this start-up wasn't from the snapshot, the app says why (CI WebKit did this once, 2026-10-17).
  await expect(dot, `boot note: ${await dot.getAttribute("data-boot-note")}`).toHaveAttribute("data-boot", "snapshot");
  await expect(dot).toHaveAttribute("data-boot-note", "");

  // A restored interpreter must behave exactly like a fresh one, interrupts included.
  const r = await run(page, "main.py", "import math\nname = input()\nprint(math.factorial(5), name)", "Abhinesh\n");
  expect(r.output).toBe("120 Abhinesh\n");
  const loop = await run(page, "main.py", "while True:\n    pass");
  expect(loop.status).toBe("timeout");
  expect((await run(page, "main.py", 'print("after")')).output).toBe("after\n");
});

test("a corrupt snapshot is discarded and Python starts normally", async ({ page }) => {
  await openApp(page);
  await waitForSnapshot(page);
  await page.evaluate(async (name) => {
    const cache = await caches.open(name);
    const [key] = await cache.keys();
    await cache.put(key, new Response(new Uint8Array([1, 2, 3, 4])));
  }, CACHE);

  await page.reload();
  await expect(page.locator("#status-dot")).toHaveAttribute("data-state", "ready", { timeout: 30_000 });
  await expect(page.locator("#status-dot")).toHaveAttribute("data-boot", "fresh");
  await expect(page.locator("#status-dot")).toHaveAttribute("data-boot-note", /^snapshot rejected: /);
  expect((await run(page, "main.py", 'print("recovered")')).output).toBe("recovered\n");
  await waitForSnapshot(page); // a good snapshot replaces the bad one
});
