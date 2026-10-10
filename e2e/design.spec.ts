import { expect, openApp, run, test } from "./helpers";

// DESIGN.md §6 matrix: desktop + mobile × light + dark, plus one reduced-motion run.
const viewports = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "mobile", width: 390, height: 844 },
];
const shots = process.env.SHOTS_DIR ?? "e2e/shots/after";

for (const vp of viewports) {
  for (const scheme of ["light", "dark"] as const) {
    test(`layout ${vp.name} ${scheme}`, async ({ page }, testInfo) => {
      const dir = `${shots}/${testInfo.project.name}`;
      await page.emulateMedia({ colorScheme: scheme });
      await page.setViewportSize(vp);
      await openApp(page);

      // Above the fold: what it is, who/why (tagline), and the primary action.
      await expect(page.getByRole("heading", { level: 1 })).toBeInViewport();
      await expect(page.locator(".tagline")).toBeInViewport();
      await expect(page.locator("#run-btn")).toBeInViewport();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

      await page.screenshot({ path: `${dir}/home-${vp.name}-${scheme}.png`, animations: "disabled" });
      await run(page, "main.py", 'name = input("Your name: ")\nprint(f"Hello, {name}!")\nprint(undefined_name)', "Abhinesh\n");
      await page.screenshot({ path: `${dir}/ran-${vp.name}-${scheme}.png`, fullPage: true, animations: "disabled" });
    });
  }
}

test("no horizontal scroll at 320 px, while loading and when ready", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  const fits = () => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
  await page.goto("/");
  await expect(page.locator("#status-dot")).toHaveAttribute("data-state", "booting");
  expect(await fits(), "while Python downloads").toBe(true);
  // Same page, no reload: wait for it to finish starting.
  await expect(page.locator("#status-dot")).toHaveAttribute("data-state", "ready", { timeout: 30_000 });
  expect(await fits(), "when ready").toBe(true);
});

test("on a phone, the output is visible after Run (not under the Run bar)", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openApp(page);
  await run(page, "main.py", "print(sum(range(10)))");
  await page.waitForTimeout(600); // smooth scroll
  const out = await page.locator("#output").boundingBox();
  const dock = await page.locator(".run-dock").boundingBox();
  const receipt = await page.locator("#receipt").boundingBox();
  expect(receipt!.y, "receipt below the top edge").toBeGreaterThanOrEqual(0);
  expect(out!.y + Math.min(out!.height, 40), "first output line above the Run bar").toBeLessThanOrEqual(dock!.y);
});

test("long lines wrap instead of scrolling the editor sideways", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openApp(page);
  await page.locator("#file-input").setInputFiles({ name: "main.py", mimeType: "text/plain", buffer: Buffer.from(`print("${"word ".repeat(40)}")\n`) });
  const overflow = await page.locator(".cm-scroller").evaluate((el) => el.scrollWidth - el.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});

test("touch targets are at least 44 px", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openApp(page);
  for (const sel of ["#open-btn", "#save-btn", "#new-btn", "#run-btn", "#filename", "#stdin-box summary"]) {
    const box = await page.locator(sel).boundingBox();
    expect(box!.height, sel).toBeGreaterThanOrEqual(44);
  }
});

test("the editor shows a visible focus ring", async ({ page }) => {
  await openApp(page);
  await page.locator(".cm-content").focus();
  const outline = await page.locator(".editor-panel").evaluate((el) => getComputedStyle(el).outlineStyle);
  expect(outline).toBe("solid");
});

test("reduced motion disables the printout animation", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await openApp(page);
  await run(page, "main.py", 'print("hi")');
  const anim = await page.locator(".printout-body").evaluate((el) => getComputedStyle(el).animationName);
  expect(anim).toBe("none");
});

test("LCP is within budget", async ({ page }) => {
  await page.goto("/");
  const lcp = await page.evaluate(() => new Promise<number>((resolve) => {
    new PerformanceObserver((list) => {
      const entries = list.getEntries();
      resolve(entries[entries.length - 1].startTime);
    }).observe({ type: "largest-contentful-paint", buffered: true });
  }));
  console.log(`LCP ${Math.round(lcp)} ms (unthrottled desktop)`);
  expect(lcp).toBeLessThan(2500);
});
