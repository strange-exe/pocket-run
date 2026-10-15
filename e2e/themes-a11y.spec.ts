import { AxeBuilder } from "@axe-core/playwright";
import { BUILT_IN } from "../src/themes";
import { expect, openApp, test } from "./helpers";

// Every built-in theme passes axe (WCAG 2.2 AA) in the app after a run, with the pointer still on Run (hover
// state), and on the about page. Contrast maths is the same in every engine, so this runs in Chromium only.
test.use({ serviceWorkers: "block" });

const scan = async (page: import("@playwright/test").Page) => {
  // Contrast is judged on the settled page: a finished run fades its output in from 40% opacity, and axe caught
  // it mid-fade on CI (2026-10-15, three themes at 4.2:1). The about page's demo run also fades its views. Only
  // time-based animations that are playing can finish (scroll-driven ones only move with scrolling).
  await page.evaluate(() => Promise.all(document.getAnimations()
    .filter((a) => a.timeline === document.timeline && a.playState === "running" && a.effect?.getComputedTiming().endTime !== Infinity)
    .map((a) => a.finished.catch(() => undefined))));
  const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
  return axe.violations.flatMap((v) => v.nodes.map((n) => `${v.id}: ${n.target.join(" ")} ${n.any.map((a) => a.message).join("; ")}`));
};

for (const theme of BUILT_IN) {
  test(`${theme.name} is readable in the app and on the about page`, async ({ page, browserName }) => {
    test.skip(browserName !== "chromium", "contrast is engine-independent; checked once");
    await page.addInitScript((id) => localStorage.setItem("pocket-run:theme", id), theme.id);
    await openApp(page);
    await page.reload(); // the start-up script paints the chosen theme on this load
    await expect(page.locator("#status-dot")).toHaveAttribute("data-state", "ready", { timeout: 30_000 });
    await page.locator("#run-btn").click();
    await expect(page.locator("#receipt")).toHaveAttribute("data-status", "ok", { timeout: 20_000 });
    expect(await scan(page), "app").toEqual([]);

    await page.goto("/about/");
    expect(await scan(page), "about").toEqual([]);
  });
}
