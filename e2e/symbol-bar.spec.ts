import { expect, openApp, openFile, test } from "./helpers";

test.describe("on a touch phone", () => {
  // Playwright's Firefox can't emulate a mobile device (isMobile); Chromium and WebKit can.
  test.skip(({ browserName }) => browserName === "firefox", "no mobile emulation in Firefox");
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test("the symbol bar appears while editing and types like the keyboard", async ({ page }) => {
    await openApp(page);
    await openFile(page, "main.py", "x = \n");
    const bar = page.locator("#symbol-bar");
    await expect(bar).toBeHidden();

    await page.locator(".cm-line").first().tap();
    await expect(bar).toBeVisible();
    await page.keyboard.press("End");

    await bar.getByRole("button", { name: "(", exact: true }).tap();
    await page.keyboard.type("a");
    await expect(page.locator(".cm-line").first()).toHaveText("x = (a)"); // pair + cursor inside, like typing
    // The editor kept focus, so the phone keyboard would have stayed open.
    expect(await page.evaluate(() => !!document.activeElement?.closest(".cm-content"))).toBe(true);

    await bar.getByRole("button", { name: "Cursor right" }).tap();
    await bar.getByRole("button", { name: ";", exact: true }).tap();
    await expect(page.locator(".cm-line").first()).toHaveText("x = (a);");

    await page.keyboard.press("Enter");
    await bar.getByRole("button", { name: "Indent" }).tap();
    await bar.getByRole("button", { name: "\\", exact: true }).tap();
    await expect(page.locator(".cm-line").nth(1)).toHaveText("    \\");

    // Leaving the editor hides it again.
    await page.locator("#filename").tap();
    await expect(bar).toBeHidden();
  });

  test("the bar's keys are full-size touch targets", async ({ page }) => {
    await openApp(page);
    await page.locator(".cm-line").first().tap();
    for (const box of await page.locator("#symbol-bar button").evaluateAll((els) => els.slice(0, 6).map((e) => e.getBoundingClientRect().height))) {
      expect(box).toBeGreaterThanOrEqual(44);
    }
  });
});

test("with a mouse, the symbol bar stays hidden", async ({ page }) => {
  await openApp(page);
  await page.locator(".cm-content").click();
  await expect(page.locator("#symbol-bar")).toBeHidden();
});
