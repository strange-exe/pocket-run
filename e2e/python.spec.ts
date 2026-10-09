import { expect, openApp, openFile, run, test } from "./helpers";

test.beforeEach(async ({ page }) => { await openApp(page); });

test.describe("correct output", () => {
  const cases: [string, string, string, string][] = [
    ["hello", 'print("hello")', "", "hello\n"],
    ["stdin a+b", "a, b = map(int, input().split())\nprint(a + b)", "3 4\n", "7\n"],
    ["stdin multi-line", "n = int(input())\nprint(sum(int(input()) for _ in range(n)))", "3\n10\n20\n30\n", "60\n"],
    ["stdlib", "import math, collections, itertools, heapq, re\nprint(math.comb(10, 3), collections.Counter('aab')['a'])", "", "120 2\n"],
    ["sep and end", 'print(1, 2, sep="-", end="!")\nprint()', "", "1-2!\n"],
    ["no trailing newline", 'print("x", end="")', "", "x"],
    ["input prompt", 'name = input("Name: ")\nprint("Hi", name)', "Asha\n", "Name: Hi Asha\n"],
    ["EOF on missing input", "try:\n    input()\nexcept EOFError:\n    print('eof')", "", "eof\n"],
    ["unicode", 'print("नमस्ते ✓")', "", "नमस्ते ✓\n"],
  ];
  for (const [name, code, stdin, expected] of cases) {
    test(name, async ({ page }) => {
      const r = await run(page, "main.py", code, stdin);
      expect(r.status).toBe("ok");
      expect(r.output).toBe(expected);
    });
  }
});

test("runtime error shows a clean traceback", async ({ page }) => {
  const r = await run(page, "main.py", "x = 1\nprint(x / 0)");
  expect(r.status).toBe("error");
  expect(r.receipt).toContain("exit 1");
  expect(r.output).toContain('File "main.py", line 2');
  expect(r.output).toContain("ZeroDivisionError");
  expect(r.output).not.toContain("_pyodide"); // our wrapper frames stay hidden
});

test("syntax error points at the line", async ({ page }) => {
  const r = await run(page, "main.py", "print('a')\nif True\n    print('b')");
  expect(r.status).toBe("error");
  expect(r.output).toContain('line 2');
  expect(r.output).toContain("SyntaxError");
});

test("sys.exit code is reported", async ({ page }) => {
  const r = await run(page, "main.py", "import sys\nprint('bye')\nsys.exit(3)");
  expect(r.status).toBe("error");
  expect(r.receipt).toContain("exit 3");
  expect(r.output).toBe("bye\n");
});

test("each run starts with fresh variables", async ({ page }) => {
  await run(page, "main.py", "leftover = 1");
  const r = await run(page, "main.py", "print('leftover' in globals())");
  expect(r.output).toBe("False\n");
});

test.describe("hostile programs are contained", () => {
  test("infinite loop is interrupted at the time limit", async ({ page }) => {
    const r = await run(page, "main.py", "print('start')\nwhile True:\n    pass");
    expect(r.status).toBe("timeout");
    expect(r.output).toContain("start");
  });

  test("C-level loop is killed and the runtime comes back", async ({ page }) => {
    const r = await run(page, "main.py", 'print("before the hang")\nsum(range(10**15))');
    expect(r.status).toBe("timeout");
    expect(r.output).toBe("before the hang\n"); // output written before a hard kill is kept
    const after = await run(page, "main.py", 'print("still alive")');
    expect(after.status).toBe("ok");
    expect(after.output).toBe("still alive\n");
  });

  test("memory bomb raises MemoryError and the next run works", async ({ page }) => {
    const r = await run(page, "main.py", "a = []\nwhile True:\n    a.append(bytearray(10**7))");
    expect(r.status).toBe("error");
    expect(r.output).toContain("MemoryError");
    const after = await run(page, "main.py", 'print("ok")');
    expect(after.output).toBe("ok\n");
  });

  test("deep recursion raises RecursionError", async ({ page }) => {
    const r = await run(page, "main.py", "def f(n):\n    return f(n + 1)\nf(0)");
    expect(r.status).toBe("error");
    expect(r.output).toContain("RecursionError");
  });

  test("output flood is cut at the cap", async ({ page }) => {
    const r = await run(page, "main.py", 'while True:\n    print("x" * 1000)');
    expect(r.status).toBe("output-limit");
    expect(r.output.length).toBeLessThanOrEqual(64 * 1024);
  });
});

test("Stop button interrupts a running program", async ({ page }) => {
  await openFile(page, "main.py", "while True:\n    pass");
  await page.locator("#run-btn").click();
  await expect(page.locator("#run-label")).toHaveText("Stop");
  await page.locator("#run-btn").click();
  await expect(page.locator("#receipt")).toHaveAttribute("data-status", "stopped", { timeout: 5_000 });
});

test("Stop works while Python is still starting", async ({ page }) => {
  await page.goto("/"); // no openApp: press Run before the runtime is ready
  await page.locator("#run-btn").click();
  await expect(page.locator("#run-label")).toHaveText("Stop");
  await page.locator("#run-btn").click();
  await expect(page.locator("#receipt")).toHaveAttribute("data-status", "stopped", { timeout: 2_000 });
  await expect(page.locator("#output")).toHaveText(""); // the program never ran
});

test.describe(() => {
  // Leaving a page mid-start cancels the abandoned page's Pyodide downloads; WebKit then reports
  // the loader's cancelled fetches. That noise belongs to the old page, not the new one.
  test.use({ tolerate: [/^Unhandled Promise Rejection: TypeError: Load failed$/] });

  test("reloading while Python is still starting doesn't break it", async ({ page }) => {
    // WebKit blocks the first workers after a reload; the runtimes must retry, not fail.
    await page.goto("/");
    await page.goto("/");
    await expect(page.locator("#status-dot")).toHaveAttribute("data-state", "ready", { timeout: 30_000 });
    expect((await run(page, "main.py", 'print("after reload")')).output).toBe("after reload\n");
  });
});

test("Ctrl+Enter runs from the editor", async ({ page }) => {
  await openFile(page, "main.py", 'print("keyboard")');
  await page.locator(".cm-content").click();
  await page.keyboard.press("Control+Enter");
  await expect(page.locator("#receipt")).toHaveAttribute("data-status", "ok");
  await expect(page.locator("#output")).toHaveText("keyboard\n");
});
