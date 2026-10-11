import { expect, openApp, test } from "./helpers";

// Requests answered by the service worker can't be held back by page.route(); block it here.
test.use({ serviceWorkers: "block" });

const bg = (page: import("@playwright/test").Page) =>
  page.evaluate(() => getComputedStyle(document.querySelector(".editor-pane")!).backgroundColor);

test("a built-in theme applies at once and is kept after a reload", async ({ page }) => {
  await openApp(page);
  await page.locator("#theme-btn").click();
  await page.getByRole("radio", { name: "Dracula" }).check();
  expect(await bg(page)).toBe("rgb(40, 42, 54)"); // Dracula background #282a36
  await page.getByRole("button", { name: "Done" }).click();

  // The start-up script paints it before the app's own code has even loaded: hold that code back.
  let release!: () => void;
  const held = new Promise<void>((r) => (release = r));
  await page.route("**/assets/index-*.js", async (route) => { await held; await route.continue(); });
  await page.reload({ waitUntil: "commit" });
  await page.locator(".editor-pane").waitFor({ state: "attached" });
  expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe("dark");
  expect(await bg(page)).toBe("rgb(40, 42, 54)");
  release();
  await expect(page.locator("#status-dot")).toHaveAttribute("data-state", "ready", { timeout: 30_000 });
});

test("'match device' follows the system light/dark setting", async ({ page }) => {
  // Emulate after the first load: Firefox drops a colour scheme set before the first
  // cross-origin-isolated navigation (measured), though it applies it to a loaded page.
  const theme = () => page.evaluate(() => document.documentElement.dataset.theme);
  await openApp(page);
  await page.emulateMedia({ colorScheme: "dark" });
  await expect.poll(theme).toBe("dark"); // switches live
  await page.reload();
  expect(await theme()).toBe("dark"); // and the start-up script picks it on load
  await page.emulateMedia({ colorScheme: "light" });
  await expect.poll(theme).toBe("light");
});

test("a custom theme can be made from the template, loaded, kept and deleted", async ({ page }) => {
  await openApp(page);
  await page.locator("#theme-btn").click();
  const download = page.waitForEvent("download");
  await page.locator("#theme-template").click();
  const template = JSON.parse(await (await (await download).createReadStream()).toArray().then((c) => Buffer.concat(c).toString("utf8")));
  expect(template.colors.sheet).toMatch(/^#[0-9a-f]{6}$/);

  template.name = "Forest";
  template.scheme = "dark";
  Object.assign(template.colors, { paper: "#0c1410", sheet: "#122019", bar: "#18281f", ink: "#e3efe6", accent: "#7cc68d", "on-accent": "#0c1410" });
  await page.locator("#theme-file").setInputFiles({ name: "forest.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(template)) });
  await expect(page.locator("#theme-message")).toContainText("Loaded “Forest”");
  expect(await bg(page)).toBe("rgb(18, 32, 25)");
  await expect(page.getByRole("radio", { name: "Forest" })).toBeChecked();

  await page.reload();
  expect(await bg(page)).toBe("rgb(18, 32, 25)");
  await page.locator("#theme-btn").click();
  await page.getByRole("button", { name: "Delete Forest" }).click();
  await expect(page.getByRole("radio", { name: "Forest" })).toHaveCount(0);
  await expect(page.getByRole("radio", { name: "Pocket Run (match device)" })).toBeChecked();
});

test.describe("theme files that aren't safe are refused", () => {
  const cases: [string, string | Buffer, RegExp][] = [
    ["CSS hidden in a colour", JSON.stringify({ name: "x", scheme: "dark", colors: { ink: "red;background:url(https://evil.example)" } }), /Unknown|Missing|must be colours/],
    ["script instead of JSON", "<script>alert(1)</script>", /isn't valid JSON/],
    ["a program renamed .json", Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00]), /Windows program/],
    ["an oversized file", " ".repeat(20 * 1024), /at most 16 KB/],
  ];
  for (const [name, content, message] of cases) {
    test(name, async ({ page }) => {
      await openApp(page);
      const before = await bg(page);
      await page.locator("#theme-btn").click();
      await page.locator("#theme-file").setInputFiles({ name: "theme.json", mimeType: "application/json", buffer: Buffer.from(content) });
      await expect(page.locator("#theme-message")).toHaveAttribute("data-tone", "error");
      await expect(page.locator("#theme-message")).toContainText(message);
      expect(await bg(page)).toBe(before);
    });
  }
});
