import type { Page } from "@playwright/test";
import { expect, openApp, openFile, showInput, test } from "./helpers";

/** Starts a run that is expected to stop and ask for input. */
async function start(page: Page, name: string, code: string, stdin = "") {
  await openFile(page, name, code);
  await showInput(page);
  await page.locator("#stdin").fill(stdin);
  await page.locator("#run-btn").click();
}

const asked = (page: Page) => expect(page.locator("#live-input")).toBeVisible({ timeout: 60_000 });

async function answer(page: Page, line: string) {
  await asked(page);
  await page.locator("#live-input-field").fill(line);
  await page.locator("#live-input-field").press("Enter");
}

async function finished(page: Page) {
  await expect(page.locator("#run-label")).toHaveText("Run", { timeout: 30_000 });
  return {
    status: await page.locator("#receipt").getAttribute("data-status"),
    output: (await page.locator("#output").textContent()) ?? "",
  };
}

test.beforeEach(async ({ page }) => { await openApp(page); });

test.describe("Python", () => {
  test("on a phone, the input field is fully above the Run bar", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await start(page, "main.py", "a = input()\nb = input()\nprint(a, b)");
    await answer(page, "one");
    await asked(page);
    await page.waitForTimeout(300);
    const form = (await page.locator("#live-input").boundingBox())!;
    const dock = (await page.locator(".run-dock").boundingBox())!;
    expect(form.y + form.height).toBeLessThanOrEqual(dock.y);
  });

  test("asks while running and shows the answer after the prompt", async ({ page }) => {
    await start(page, "main.py", 'name = input("Your name: ")\nprint(f"Hello, {name}!")');
    await asked(page);
    await expect(page.locator("#output")).toHaveText("Your name: "); // the prompt is visible before typing
    await expect(page.locator("#receipt")).toContainText("waiting for your input");
    await answer(page, "Abhinesh");
    const r = await finished(page);
    expect(r.status).toBe("ok");
    expect(r.output).toBe("Your name: Abhinesh\nHello, Abhinesh!\n");
    await expect(page.locator("#live-input")).toBeHidden();
  });

  test("the Input box is used first; only the rest is asked for", async ({ page }) => {
    await start(page, "main.py", "a = int(input())\nb = int(input())\nprint(a + b)", "40");
    await answer(page, "2");
    const r = await finished(page);
    expect(r.output).toBe("2\n42\n"); // only the live answer is echoed
  });

  test("time spent waiting doesn't count toward the 8 s limit", async ({ page }) => {
    await start(page, "main.py", 'x = input("x? ")\nprint("got", x)');
    await asked(page);
    await page.waitForTimeout(9_000); // longer than the whole time limit
    await answer(page, "late");
    const r = await finished(page);
    expect(r.status).toBe("ok");
    expect(r.output).toContain("got late");
  });

  test("End input sends end-of-file", async ({ page }) => {
    await start(page, "main.py", "import sys\nprint(sum(int(l) for l in sys.stdin))");
    await answer(page, "1");
    await answer(page, "2");
    await asked(page);
    await page.getByRole("button", { name: "End input" }).click();
    const r = await finished(page);
    expect(r.output).toBe("1\n2\n(end of input)\n3\n");
  });

  test("Ctrl+D also ends input", async ({ page }) => {
    await start(page, "main.py", "try:\n    input()\nexcept EOFError:\n    print('eof')");
    await asked(page);
    await page.locator("#live-input-field").press("Control+d");
    expect((await finished(page)).output).toBe("(end of input)\neof\n");
  });

  test("Stop works while the program waits for input", async ({ page }) => {
    await start(page, "main.py", "input()");
    await asked(page);
    await page.locator("#run-btn").click();
    const r = await finished(page);
    expect(r.status).toBe("stopped");
    await expect(page.locator("#live-input")).toBeHidden();
    await start(page, "main.py", 'print("next run")');
    expect((await finished(page)).output).toBe("next run\n");
  });
});

test.describe("C and C++", () => {
  test.beforeEach(async ({ page }) => {
    await openFile(page, "main.c", "int main(void) { return 0; }\n");
    await page.locator("#pack-button").click();
    await expect(page.locator("#status-dot")).toHaveAttribute("data-state", "ready", { timeout: 60_000 });
  });

  test("a printf prompt without a newline shows before scanf waits", async ({ page }) => {
    await start(page, "main.c", '#include <stdio.h>\nint main(void) { int n; printf("Enter n: "); scanf("%d", &n); printf("%d\\n", n * n); }');
    await asked(page);
    await expect(page.locator("#output")).toHaveText("Enter n: ");
    await answer(page, "7");
    const r = await finished(page);
    expect(r.status).toBe("ok");
    expect(r.output).toBe("Enter n: 7\n49\n");
  });

  test("C++ cin reads several live lines, and end of input stops the loop", async ({ page }) => {
    await start(page, "main.cpp", '#include <iostream>\nint main() { long s = 0; int x; std::cout << "numbers: " << std::flush; while (std::cin >> x) s += x; std::cout << "sum " << s << "\\n"; }');
    await answer(page, "10 20");
    await answer(page, "12");
    await asked(page);
    await page.getByRole("button", { name: "End input" }).click();
    const r = await finished(page);
    expect(r.output).toBe("numbers: 10 20\n12\n(end of input)\nsum 42\n");
  });

  test("Stop works while a C program waits for input", async ({ page }) => {
    await start(page, "main.c", '#include <stdio.h>\nint main(void) { int n; scanf("%d", &n); }');
    await asked(page);
    await page.locator("#run-btn").click();
    expect((await finished(page)).status).toBe("stopped");
  });
});
