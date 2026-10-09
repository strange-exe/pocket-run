import type { Page } from "@playwright/test";
import { expect, openApp, openFile, run, test } from "./helpers";

/** Installs the C/C++ pack the way a student does: open a C file, press Download. */
async function installCpp(page: Page) {
  await openFile(page, "main.c", "int main(void) { return 0; }\n");
  await expect(page.locator("#pack-offer")).toBeVisible();
  await page.locator("#pack-button").click();
  await expect(page.locator("#status-dot")).toHaveAttribute("data-state", "ready", { timeout: 60_000 });
  await expect(page.locator("#pack-offer")).toBeHidden();
}

test.describe("C and C++", () => {
  test.beforeEach(async ({ page }) => {
    await openApp(page);
    await installCpp(page);
  });

  const cases: [string, string, string, string, string][] = [
    ["C hello", "main.c", '#include <stdio.h>\nint main(void) { printf("hello\\n"); return 0; }', "", "hello\n"],
    ["C scanf", "main.c", '#include <stdio.h>\nint main(void) { int a, b; scanf("%d %d", &a, &b); printf("%d\\n", a + b); }', "3 4\n", "7\n"],
    ["C math.h + doubles", "main.c", '#include <stdio.h>\n#include <math.h>\nint main(void) { printf("%.3f\\n", sqrt(2.0)); }', "", "1.414\n"],
    ["C++ iostream, vector, sort", "main.cpp", '#include <iostream>\n#include <vector>\n#include <algorithm>\nint main() { std::vector<int> v{3, 1, 2}; std::sort(v.begin(), v.end()); for (int x : v) std::cout << x << " "; std::cout << "\\n"; }', "", "1 2 3 \n"],
    ["C++ cin over lines", "main.cpp", '#include <iostream>\nint main() { int n; std::cin >> n; long s = 0; for (int i = 0; i < n; i++) { int x; std::cin >> x; s += x; } std::cout << s << std::endl; }', "3\n10\n20\n30\n", "60\n"],
    ["C++17 map + structured bindings", "main.cpp", '#include <iostream>\n#include <map>\n#include <string>\nint main() { std::map<std::string, int> m{{"b", 2}, {"a", 1}}; for (auto& [k, v] : m) std::cout << k << v; std::cout << "\\n"; }', "", "a1b2\n"],
    ["C++ getline + stringstream", "main.cpp", '#include <iostream>\n#include <sstream>\n#include <string>\nint main() { std::string line; std::getline(std::cin, line); std::stringstream ss(line); int x, s = 0; while (ss >> x) s += x; std::cout << s << "\\n"; }', "1 2 3 4\n", "10\n"],
    ["bits/stdc++.h", "main.cpp", '#include <bits/stdc++.h>\nusing namespace std;\nint main() { priority_queue<int> q; q.push(4); q.push(9); cout << q.top() << "\\n"; }', "", "9\n"],
    ["setprecision", "main.cpp", '#include <iostream>\n#include <iomanip>\nint main() { std::cout << std::fixed << std::setprecision(2) << 3.14159 << "\\n"; }', "", "3.14\n"],
    [".cc extension is C++", "solve.cc", '#include <iostream>\nint main() { std::cout << "cc\\n"; }', "", "cc\n"],
  ];
  for (const [name, file, code, stdin, expected] of cases) {
    test(name, async ({ page }) => {
      const r = await run(page, file, code, stdin);
      expect(r.status, r.output).toBe("ok");
      expect(r.output).toBe(expected);
      expect(r.receipt).toContain("compiled in");
    });
  }

  test("exit code is reported", async ({ page }) => {
    const r = await run(page, "main.c", "#include <stdlib.h>\nint main(void) { exit(5); }");
    expect(r.status).toBe("error");
    expect(r.receipt).toContain("exit 5");
  });

  test("compile errors show clang's message with the line", async ({ page }) => {
    const r = await run(page, "main.c", "int main(void) {\n  return x;\n}");
    expect(r.status).toBe("compile-error");
    expect(r.receipt).toContain("didn't compile");
    expect(r.output).toContain("main.c:2:10: error: use of undeclared identifier 'x'");
    expect(r.output).not.toContain("process exited"); // the toolchain's own noise is removed
  });

  test("C++ exceptions explain the limitation", async ({ page }) => {
    const r = await run(page, "main.cpp", '#include <stdexcept>\nint main() { try { throw std::runtime_error("x"); } catch (...) {} }');
    expect(r.status).toBe("compile-error");
    expect(r.output).toContain("C++ exceptions (try / throw / catch) are not supported");
  });

  test("a missing main() is explained", async ({ page }) => {
    const r = await run(page, "main.c", "int helper(void) { return 1; }");
    expect(r.status).toBe("compile-error");
    expect(r.output).toContain("needs an int main()");
  });

  test.describe("hostile programs are contained", () => {
    test("infinite loop hits the time limit, then the next run works", async ({ page }) => {
      const r = await run(page, "main.c", '#include <stdio.h>\nint main(void) { printf("start\\n"); fflush(stdout); volatile int x = 0; for (;;) x++; }');
      expect(r.status).toBe("timeout");
      expect(r.output).toContain("start"); // output before the hang is still shown
      expect((await run(page, "main.c", '#include <stdio.h>\nint main(void) { puts("alive"); }')).output).toBe("alive\n");
    });

    test("stack overflow is a readable crash", async ({ page }) => {
      const r = await run(page, "main.c", "int f(int n) { volatile char b[1024]; b[0] = n; return f(n + 1) + b[0]; }\nint main(void) { return f(0); }");
      expect(r.status).toBe("error");
      expect(r.receipt).toContain("crashed");
      expect(r.output).toContain("stack overflow");
    });

    test("a bad pointer is a readable crash", async ({ page }) => {
      const r = await run(page, "main.c", "int main(void) { int *p = (int *)0x7ffffff0; return p[0x1000000]; }");
      expect(r.status).toBe("error");
      expect(r.output).toContain("invalid memory access");
    });

    test("memory bomb stays inside the 256 MB cap", async ({ page }) => {
      const r = await run(page, "main.c", "#include <stdlib.h>\n#include <string.h>\nint main(void) { for (;;) { char *p = malloc(1 << 24); if (!p) return 3; memset(p, 1, 1 << 24); } }");
      expect(["timeout", "error"]).toContain(r.status);
      expect((await run(page, "main.c", '#include <stdio.h>\nint main(void) { puts("ok"); }')).output).toBe("ok\n");
    });

    test("output flood is cut at the cap", async ({ page }) => {
      const r = await run(page, "main.c", '#include <stdio.h>\nint main(void) { for (;;) puts("xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"); }');
      expect(r.status).toBe("output-limit");
      expect(r.output.length).toBeLessThanOrEqual(64 * 1024);
    });
  });

  test("Stop ends a running C program", async ({ page }) => {
    await openFile(page, "main.c", "int main(void) { volatile int x = 0; for (;;) x++; }");
    await page.locator("#run-btn").click();
    await expect(page.locator("#receipt")).toContainText("running", { timeout: 15_000 });
    await page.locator("#run-btn").click();
    await expect(page.locator("#receipt")).toHaveAttribute("data-status", "stopped", { timeout: 3_000 });
    expect((await run(page, "main.c", '#include <stdio.h>\nint main(void) { puts("after"); }')).output).toBe("after\n");
  });

  test("Python still works after switching from C", async ({ page }) => {
    await run(page, "main.c", '#include <stdio.h>\nint main(void) { puts("c"); }');
    const r = await run(page, "main.py", 'print("py")');
    expect(r.output).toBe("py\n");
    await expect(page.locator("#status-text")).toContainText("Python ready");
  });
});

test("C asks for the one-time download instead of failing", async ({ page }) => {
  await openApp(page);
  await openFile(page, "main.cpp", "int main() {}\n");
  await expect(page.locator("#status-text")).toContainText("one-time");
  await expect(page.locator("#pack-button")).toHaveText(/Download C\/C\+\+ \(\d+\.\d MB\)/);
  await page.locator("#run-btn").click();
  await expect(page.locator("#notice")).toContainText("Download the C/C++ compiler first");
  await expect(page.locator("#pack-button")).toBeFocused();
});

test("on a phone, Run brings the download button fully above the Run bar", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openApp(page);
  await openFile(page, "main.c", "int main(void) { return 0; }\n");
  await page.locator("#run-btn").click();
  await expect(page.locator("#pack-button")).toBeFocused();
  const button = (await page.locator("#pack-button").boundingBox())!;
  const dock = (await page.locator(".run-dock").boundingBox())!;
  expect(button.y + button.height).toBeLessThanOrEqual(dock.y);
});

test("after installing, C/C++ works with no network", async ({ page, context }) => {
  await openApp(page);
  await installCpp(page);
  await expect(page.locator("#status-text")).toContainText("works offline", { timeout: 60_000 }); // wait for Python's precache too
  await context.setOffline(true);
  await page.reload();
  await openFile(page, "main.cpp", "int main() {}\n");
  await expect(page.locator("#status-dot")).toHaveAttribute("data-state", "ready", { timeout: 60_000 });
  const r = await run(page, "main.cpp", '#include <iostream>\nint main() { std::cout << 6 * 7 << "\\n"; }');
  expect(r.output).toBe("42\n");
});
