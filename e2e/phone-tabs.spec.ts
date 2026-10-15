import { AxeBuilder } from "@axe-core/playwright";
import { expect, openApp, openFile, showInput, test } from "./helpers";

// Phones: Code and Output are two tabs (src/view-tabs.ts), chosen by the student 2026-10-15 (layout A).
test.describe("on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("Run switches to Output; a result that arrives while on Code marks the tab", async ({ page }) => {
    await openApp(page);
    const code = page.getByRole("tab", { name: "Code" });
    const out = page.getByRole("tab", { name: /^Output/ });
    await expect(code).toHaveAttribute("aria-selected", "true");
    await expect(page.locator("#panel-output")).toBeHidden();

    await openFile(page, "main.py", 'name = input("Your name: ")\nprint(f"Hi {name}")\n');
    await showInput(page);
    await page.locator("#stdin").fill("");
    await code.click();
    await page.locator("#run-btn").click();
    await expect(out).toHaveAttribute("aria-selected", "true"); // the run is watched in Output
    await expect(page.locator("#live-input-field")).toBeVisible({ timeout: 20_000 });
    await expect(page.locator("#live-input-field")).toBeInViewport();

    await code.click(); // the student looks back at the code while the program waits
    await expect(page.locator("#panel-code")).toBeVisible();
    await out.click();
    await page.locator("#live-input-field").fill("Abhinesh");
    await page.locator("#live-input-field").press("Enter");
    await expect(page.locator("#run-label")).toHaveText("Run", { timeout: 20_000 });
    await expect(page.locator("#tab-badge")).toBeHidden(); // seen in place: nothing to mark

    // A result arriving while Code shows marks Output, and opening Output clears the mark.
    await openFile(page, "main.py", "import time\ntime.sleep(1)\nprint('done')\n");
    await page.locator("#run-btn").click();
    await code.click();
    await expect(page.locator("#run-label")).toHaveText("Run", { timeout: 20_000 });
    await expect(page.locator("#tab-badge")).toBeVisible();
    await expect(out).toHaveAccessibleName(/new result/);
    await out.click();
    await expect(page.locator("#tab-badge")).toBeHidden();
    await expect(page.locator("#output")).toHaveText("done\n");
  });

  test("both tabs pass axe (WCAG 2.2 AA), before and after a run", async ({ page }) => {
    await openApp(page);
    const scan = async () => (await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze())
      .violations.flatMap((v) => v.nodes.map((n) => `${v.id}: ${n.target.join(" ")}`));
    expect(await scan(), "Code tab").toEqual([]);
    await page.locator("#run-btn").click(); // the sample: its Input box answers the prompt
    await expect(page.locator("#run-label")).toHaveText("Run", { timeout: 20_000 });
    expect(await scan(), "Output tab after a run").toEqual([]);
  });

  test("the tabs follow the keyboard pattern: arrows, Home and End", async ({ page }) => {
    await openApp(page);
    const code = page.getByRole("tab", { name: "Code" });
    const out = page.getByRole("tab", { name: /^Output/ });
    await expect(page.getByRole("tablist")).toBeVisible();
    await code.focus();
    await page.keyboard.press("ArrowRight");
    await expect(out).toBeFocused();
    await expect(out).toHaveAttribute("aria-selected", "true");
    await expect(code).toHaveAttribute("tabindex", "-1"); // only the selected tab is in the Tab order
    await page.keyboard.press("Home");
    await expect(code).toBeFocused();
    await page.keyboard.press("End");
    await expect(out).toBeFocused();
    await page.keyboard.press("ArrowRight"); // wraps around
    await expect(code).toHaveAttribute("aria-selected", "true");
  });
});

test("on a wide screen there are no tabs: code and output side by side", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openApp(page);
  await expect(page.locator("#view-tabs")).toBeHidden();
  await expect(page.getByRole("tablist")).toHaveCount(0);
  await expect(page.locator("#panel-code")).not.toHaveAttribute("role");
  await expect(page.locator("#panel-code")).toBeVisible();
  await expect(page.locator("#panel-output")).toBeVisible();
});
