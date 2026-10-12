import { expect, openApp, test } from "./helpers";

// The one-time welcome note in the Output panel (first visit only; never on share links).
test("a first visit shows the welcome; pressing Run retires it for good", async ({ page }) => {
  await openApp(page);
  const welcome = page.locator("#welcome");
  await expect(welcome).toBeVisible();
  await expect(welcome).toContainText("Press Run to try the sample program");
  await expect(welcome.getByRole("link", { name: /About Pocket Run/ })).toHaveAttribute("href", "/about/");
  await expect(page.locator("#output")).toBeHidden(); // its own "Nothing printed yet." would repeat the note

  await page.locator("#run-btn").click();
  await expect(welcome).toBeHidden();
  await expect(page.locator("#receipt")).toHaveAttribute("data-status", "ok", { timeout: 20_000 });
  await page.reload();
  await expect(page.locator("#status-dot")).toHaveAttribute("data-state", "ready", { timeout: 30_000 });
  await expect(welcome).toBeHidden();
});

test("closing the welcome keeps it closed", async ({ page }) => {
  await openApp(page);
  await page.getByRole("button", { name: "Dismiss welcome" }).click();
  await expect(page.locator("#welcome")).toBeHidden();
  await page.reload();
  await expect(page.locator("#welcome")).toBeHidden();
});

test("someone arriving through a share link doesn't get the welcome", async ({ page }) => {
  await openApp(page);
  const link = await page.evaluate(async () => {
    const packed = await new Response(new Blob([JSON.stringify({ v: 1, f: "a.py", c: "print(1)", i: "" })]).stream()
      .pipeThrough(new CompressionStream("deflate-raw"))).arrayBuffer();
    let s = "";
    for (const b of new Uint8Array(packed)) s += String.fromCharCode(b);
    return "/#s=" + btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  });
  const fresh = await page.context().browser()!.newContext();
  const other = await fresh.newPage();
  await other.goto(link);
  await expect(other.locator("#status-dot")).toHaveAttribute("data-state", "ready", { timeout: 30_000 });
  await expect(other.locator("#notice")).toContainText("Opened a shared file");
  await expect(other.locator("#welcome")).toBeHidden();
  await fresh.close();
});

test("on a phone the welcome is the notice right above Run, and it retires after a run", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openApp(page);
  const notice = page.locator("#notice");
  await expect(notice).toContainText("New here? Press Run to try the sample program.");
  await expect(notice).toBeInViewport();
  await expect(page.locator("#welcome")).toBeHidden(); // the panel copy stays hidden below the fold
  await page.locator("#run-btn").click();
  await expect(page.locator("#receipt")).toHaveAttribute("data-status", "ok", { timeout: 20_000 });
  await expect(notice).not.toContainText("New here?");
  await page.reload();
  await expect(page.locator("#status-dot")).toHaveAttribute("data-state", "ready", { timeout: 30_000 });
  await expect(notice).not.toContainText("New here?");
});

test("on a phone the header keeps About and Theme reachable and the status unclipped", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openApp(page);
  for (const name of ["About Pocket Run", "Colour theme"]) {
    const box = (await page.locator(".masthead").getByRole(name.startsWith("About") ? "link" : "button", { name }).boundingBox())!;
    expect(box.height, name).toBeGreaterThanOrEqual(44);
    expect(box.width, name).toBeGreaterThanOrEqual(44);
  }
  // The full status text fits on its own line (no ellipsis).
  const status = page.locator("#status-text");
  expect(await status.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
});
