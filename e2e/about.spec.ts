import { AxeBuilder } from "@axe-core/playwright";
import { expect, openApp, test } from "./helpers";

// DESIGN.md §6 matrix for the about page: desktop + mobile, light + dark, reduced motion, axe,
// overflow, primary action above the fold, grayscale + blur hierarchy shots.
const viewports = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "mobile", width: 390, height: 844 },
];
const shots = process.env.SHOTS_DIR ?? "e2e/shots/after";

/**
 * Opens the about page in a colour scheme. Firefox drops a scheme emulated before the first
 * cross-origin-isolated navigation (see themes.spec.ts), so load, emulate, reload, and check it took.
 */
async function openAbout(page: import("@playwright/test").Page, scheme: "light" | "dark", reducedMotion?: "reduce") {
  await page.goto("/about/");
  await page.emulateMedia({ colorScheme: scheme, ...(reducedMotion ? { reducedMotion } : {}) });
  await page.reload();
  expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe(scheme);
}

for (const vp of viewports) {
  for (const scheme of ["light", "dark"] as const) {
    test(`about ${vp.name} ${scheme}`, async ({ page }, testInfo) => {
      const failed: string[] = [];
      page.on("requestfailed", (r) => failed.push(`${r.url()} ${r.failure()?.errorText}`));
      page.on("response", (r) => { if (r.status() >= 400) failed.push(`${r.status()} ${r.url()}`); });
      await page.setViewportSize(vp);
      await openAbout(page, scheme);

      // Above the fold: what it is (headline), and the one thing to do next.
      await expect(page.getByRole("heading", { level: 1 })).toBeInViewport();
      await expect(page.locator(".hero").getByRole("link", { name: "Open Pocket Run" })).toBeInViewport();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
      // The screenshot matching the theme is the one shown.
      const image = await page.locator(".shot").evaluate((el) => getComputedStyle(el).backgroundImage);
      expect(image).toContain(`app-${scheme}.webp`);

      const dir = `${shots}/${testInfo.project.name}`;
      await page.screenshot({ path: `${dir}/about-${vp.name}-${scheme}.png`, fullPage: true, animations: "disabled" });
      expect(failed).toEqual([]);
    });
  }
}

for (const scheme of ["light", "dark"] as const) {
  test(`about accessibility and hierarchy ${scheme}`, async ({ page }, testInfo) => {
    await openAbout(page, scheme, "reduce");
    const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
    expect(axe.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);
    const dir = `${shots}/${testInfo.project.name}`;
    for (const [name, filter] of [["gray", "grayscale(1)"], ["blur", "blur(6px)"]] as const) {
      const tag = await page.addStyleTag({ content: `html{filter:${filter}}` });
      await page.screenshot({ path: `${dir}/about-${scheme}-${name}.png`, animations: "disabled" });
      await tag.evaluate((el) => (el as Element).remove());
    }
  });
}

test("Open Pocket Run goes to the app, and the app links back here", async ({ page }) => {
  await page.goto("/about/");
  await page.locator(".hero").getByRole("link", { name: "Open Pocket Run" }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.locator("#status-dot")).toHaveAttribute("data-state", "ready", { timeout: 30_000 });
  await page.locator(".masthead").getByRole("link", { name: "About Pocket Run" }).click();
  await expect(page).toHaveURL(/\/about\/$/);
});

test("the about page follows the theme chosen in the app", async ({ page }) => {
  await openApp(page);
  await page.locator("#theme-btn").click();
  await page.getByRole("radio", { name: "Dracula" }).check();
  await page.goto("/about/");
  expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe("dark");
  expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe("rgb(33, 34, 44)"); // Dracula paper
});

test("the about page works offline, screenshot included", async ({ page, context }) => {
  await openApp(page);
  // The app's own signal that the service worker has precached everything (as in offline.spec.ts).
  await expect(page.locator("#status-text")).toContainText("works offline", { timeout: 60_000 });
  await context.setOffline(true);
  await page.goto("/about/");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  const loaded = await page.evaluate(() => new Promise<boolean>((resolve) => {
    const img = new Image();
    img.onload = () => resolve(true);
    img.onerror = () => resolve(false);
    img.src = "/about/app-light.webp";
  }));
  expect(loaded).toBe(true);
});

test("the about page loads no script besides the theme starter", async ({ page }) => {
  const scripts: string[] = [];
  page.on("request", (r) => { if (r.resourceType() === "script") scripts.push(new URL(r.url()).pathname); });
  await page.goto("/about/");
  await page.waitForLoadState("networkidle");
  expect(scripts).toEqual(["/theme-boot.js"]);
});
