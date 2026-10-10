import type { Page } from "@playwright/test";
import { expect, openApp, openFile, showInput, test } from "./helpers";

/** Clipboard permissions differ per browser, so tests capture what Share copies instead. */
async function captureClipboard(page: Page) {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: async (text: string) => { (window as unknown as { __copied: string }).__copied = text; } },
    });
  });
}

async function shareCurrentFile(page: Page): Promise<string> {
  await page.locator("#share-btn").click();
  await expect(page.locator("#notice")).toContainText("Link copied");
  return page.evaluate(() => (window as unknown as { __copied: string }).__copied);
}

test("a share link opens the file, file name and input in a new browser, without running it", async ({ page, browser }) => {
  await captureClipboard(page);
  await openApp(page);
  const code = 'name = input()\nprint("hi", name, "✓")\n';
  await openFile(page, "greet.py", code);
  await showInput(page);
  await page.locator("#stdin").fill("Abhinesh\n");
  const url = await shareCurrentFile(page);
  expect(url).toMatch(/#s=[\w-]+$/);

  // Someone else opens the link: a fresh browser with a file of their own.
  const otherContext = await browser.newContext(); // doesn't inherit baseURL, so use absolute URLs
  const other = await otherContext.newPage();
  await other.goto(new URL("/", url).href);
  await other.locator("#file-input").setInputFiles({ name: "mine.c", mimeType: "text/plain", buffer: Buffer.from("int main(void) { return 0; }\n") });
  await expect(other.locator("#filename")).toHaveValue("mine.c");
  await other.waitForTimeout(500); // the draft is saved 300 ms after a change

  await other.goto(url);
  await expect(other.locator("#filename")).toHaveValue("greet.py");
  await expect(other.locator(".cm-content")).toContainText('print("hi", name, "✓")');
  await expect(other.locator("#stdin")).toHaveValue("Abhinesh\n");
  await expect(other.locator("#notice")).toContainText("hasn't been run");
  await expect(other.locator("#output")).toHaveText(""); // nothing ran
  expect(new URL(other.url()).hash).toBe(""); // a reload won't re-import it

  await other.getByRole("button", { name: "Restore mine" }).click();
  await expect(other.locator("#filename")).toHaveValue("mine.c");
  await expect(other.locator(".cm-content")).toContainText("int main(void)");

  // Opening the link in a fresh tab (a full page load, not just a fragment change) works too.
  const fresh = await otherContext.newPage();
  await fresh.goto(url);
  await expect(fresh.locator("#filename")).toHaveValue("greet.py");
  await expect(fresh.locator("#output")).toHaveText("");
  await otherContext.close();
});

test("a damaged share link is ignored and the student's file stays", async ({ page }) => {
  await openApp(page);
  await openFile(page, "keep.py", 'print("keep")\n');
  await page.waitForTimeout(500);
  await page.goto("/#s=this-is-not-a-real-link");
  await expect(page.locator("#filename")).toHaveValue("keep.py");
  await expect(page.locator("#notice")).toBeHidden();
});

test("files too long for a link say so", async ({ page }) => {
  await captureClipboard(page);
  await openApp(page);
  // Pseudo-random text (an LCG) barely compresses, unlike anything repetitive.
  let x = 12345;
  const noise = Array.from({ length: 20000 }, () => { x = (x * 1103515245 + 12345) & 0x7fffffff; return String.fromCharCode(33 + (x % 90)); }).join("");
  await openFile(page, "big.py", `# ${noise}\n`);
  await page.locator("#share-btn").click();
  await expect(page.locator("#notice")).toContainText("too long to share as a link");
});
