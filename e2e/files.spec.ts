import { readFile } from "node:fs/promises";
import { expect, openApp, openFile, showInput, test } from "./helpers";

test.beforeEach(async ({ page }) => { await openApp(page); });

test("opening a file picks the language from its extension", async ({ page }) => {
  await openFile(page, "hello.cpp", "int main() {}\n");
  await expect(page.locator("#lang-tag")).toHaveText("C++");
  await openFile(page, "hello.c", "int main(void) { return 0; }\n");
  await expect(page.locator("#lang-tag")).toHaveText("C");
  await openFile(page, "hello.py", "print(1)\n");
  await expect(page.locator("#lang-tag")).toHaveText("Python");
});

test("renaming the file switches the language", async ({ page }) => {
  await page.locator("#filename").fill("solve.c");
  await expect(page.locator("#lang-tag")).toHaveText("C");
  await page.locator("#filename").fill("solve.txt");
  await expect(page.locator("#lang-tag")).toHaveText("Unknown type");
});

test("unsupported files are refused with a reason", async ({ page }) => {
  await page.locator("#file-input").setInputFiles({ name: "app.js", mimeType: "text/javascript", buffer: Buffer.from("1") });
  await expect(page.locator("#notice")).toContainText("isn't a Python, C or C++ file");
  await expect(page.locator("#filename")).not.toHaveValue("app.js");
});

test("binary files are refused", async ({ page }) => {
  await page.locator("#file-input").setInputFiles({ name: "x.py", mimeType: "application/octet-stream", buffer: Buffer.from([0x7f, 0x45, 0, 1]) });
  await expect(page.locator("#notice")).toContainText("binary");
});

test("Save downloads the file with its name and exact contents", async ({ page }) => {
  const code = 'print("saved")\n# ünïcode ✓\n';
  await openFile(page, "keep.py", code);
  const [download] = await Promise.all([page.waitForEvent("download"), page.locator("#save-btn").click()]);
  expect(download.suggestedFilename()).toBe("keep.py");
  expect(await readFile((await download.path())!, "utf8")).toBe(code);
});

test("New replaces the code with a template for the chosen language", async ({ page }) => {
  await page.locator("#new-btn").click();
  await page.getByRole("button", { name: /^C\+\+/ }).click();
  await expect(page.locator("#filename")).toHaveValue("main.cpp");
  await expect(page.locator(".cm-content")).toContainText("std::cout");
});

test("the draft survives a reload", async ({ page }) => {
  await openFile(page, "draft.py", 'print("remember me")\n');
  await showInput(page);
  await page.locator("#stdin").fill("42");
  await page.waitForTimeout(500); // drafts are saved 300 ms after the last change
  await page.reload();
  await expect(page.locator("#filename")).toHaveValue("draft.py");
  await expect(page.locator(".cm-content")).toContainText("remember me");
  await expect(page.locator("#stdin")).toHaveValue("42");
});
