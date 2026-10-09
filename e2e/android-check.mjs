// Runs the production build in Chrome on an Android emulator or USB device.
//
//   adb reverse tcp:4318 tcp:4318          # device localhost -> this PC (a secure context)
//   npx vite preview --host 127.0.0.1 --port 4318
//   node e2e/android-check.mjs online      # cold load, runs, screenshots
//   (stop the preview server)
//   node e2e/android-check.mjs offline     # reload with no server: must come from the service worker
//
// Connects over Chrome's DevTools socket (what chrome://inspect uses), so no Chrome flags are needed.
import { execFileSync } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { chromium } from "@playwright/test";

const mode = process.argv[2] ?? "online";
const ORIGIN = "http://localhost:4318";
const DEVTOOLS_PORT = 9333;
const shots = "e2e/shots/android";
await mkdir(shots, { recursive: true });

execFileSync("adb", ["forward", `tcp:${DEVTOOLS_PORT}`, "localabstract:chrome_devtools_remote"]);
const browser = await chromium.connectOverCDP(`http://127.0.0.1:${DEVTOOLS_PORT}`);
const context = browser.contexts()[0];
const report = { mode, device: execFileSync("adb", ["shell", "getprop", "ro.product.model"]).toString().trim(), checks: [] };
const check = (name, pass, detail = {}) => { report.checks.push({ name, pass, ...detail }); };

const page = await context.newPage();
const errors = [];
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
page.on("pageerror", (e) => errors.push(e.message));

const waitReady = (timeout) => page.waitForSelector('#status-dot[data-state="ready"]', { timeout });

async function runProgram(name, code, stdin = "") {
  await page.evaluate(([name, code]) => {
    const input = document.getElementById("file-input");
    const dt = new DataTransfer();
    dt.items.add(new File([code], name));
    input.files = dt.files;
    input.dispatchEvent(new Event("change"));
  }, [name, code]);
  await page.waitForFunction((n) => document.getElementById("filename").value === n, name);
  await page.evaluate((s) => {
    document.getElementById("stdin-box").open = true;
    const t = document.getElementById("stdin");
    t.value = s;
    t.dispatchEvent(new Event("input"));
  }, stdin);
  const t0 = Date.now();
  await page.click("#run-btn");
  await page.waitForFunction(() => document.getElementById("run-label").textContent === "Run" && document.getElementById("receipt").dataset.status, null, { timeout: 30_000 });
  return {
    wallMs: Date.now() - t0,
    status: await page.getAttribute("#receipt", "data-status"),
    receipt: await page.textContent("#receipt"),
    output: await page.textContent("#output"),
  };
}

if (mode === "online") {
  // Start from a first visit: no cache, no service worker, no saved draft.
  const cdp = await context.newCDPSession(page);
  await cdp.send("Storage.clearDataForOrigin", { origin: ORIGIN, storageTypes: "all" });

  const t0 = Date.now();
  await page.goto(ORIGIN);
  const lcp = await page.evaluate(() => new Promise((resolve) => {
    new PerformanceObserver((l) => { const e = l.getEntries(); resolve(e[e.length - 1].startTime); })
      .observe({ type: "largest-contentful-paint", buffered: true });
  }));
  await waitReady(120_000);
  const firstReadyMs = Date.now() - t0;
  await page.waitForFunction(() => document.getElementById("status-text").textContent.includes("works offline"), null, { timeout: 180_000 });
  const offlineReadyMs = Date.now() - t0;
  check("first visit: Python ready", true, { lcpMs: Math.round(lcp), firstReadyMs, offlineReadyMs });
  check("cross-origin isolated (Stop can interrupt)", await page.evaluate(() => crossOriginIsolated));
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  check("no horizontal scroll", overflow <= 0, { viewport: await page.evaluate(() => `${innerWidth}x${innerHeight}`), overflow });
  await page.screenshot({ path: `${shots}/home.png` });

  const cases = [
    ["hello", "main.py", 'print("hello")', "", (r) => r.status === "ok" && r.output === "hello\n"],
    ["stdin", "main.py", "a, b = map(int, input().split())\nprint(a + b)", "3 4\n", (r) => r.output === "7\n"],
    ["unicode", "main.py", 'print("नमस्ते ✓")', "", (r) => r.output === "नमस्ते ✓\n"],
    ["traceback", "main.py", "x = 1\nprint(x / 0)", "", (r) => r.status === "error" && r.output.includes('File "main.py", line 2') && !r.output.includes("_pyodide")],
    ["infinite loop → timeout", "main.py", "while True:\n    pass", "", (r) => r.status === "timeout"],
    ["C-level loop → kill + reboot", "main.py", "sum(range(10**15))", "", (r) => r.status === "timeout"],
    ["after kill", "main.py", 'print("still alive")', "", (r) => r.output === "still alive\n"],
    ["recursion", "main.py", "def f(n):\n    return f(n + 1)\nf(0)", "", (r) => r.output.includes("RecursionError")],
    ["output flood", "main.py", 'while True:\n    print("x" * 1000)', "", (r) => r.status === "output-limit"],
    // Low-RAM devices slow down long before Python's heap limit, so the time limit may stop
    // it first. Either way it must be contained, and the next run below must work.
    ["memory bomb", "main.py", "a = []\nwhile True:\n    a.append(bytearray(10**7))", "", (r) => r.output.includes("MemoryError") || r.status === "timeout"],
    ["after memory bomb", "main.py", 'print("ok")', "", (r) => r.output === "ok\n"],
  ];
  for (const [label, name, code, stdin, ok] of cases) {
    const r = await runProgram(name, code, stdin);
    check(label, ok(r), { status: r.status, wallMs: r.wallMs, receipt: r.receipt?.trim() });
  }
  // ---- C / C++: one-time download, then compile + run on the device ----
  await page.evaluate(() => {
    const dt = new DataTransfer();
    dt.items.add(new File(["int main(void) { return 0; }\n"], "main.c"));
    const input = document.getElementById("file-input");
    input.files = dt.files;
    input.dispatchEvent(new Event("change"));
  });
  await page.waitForSelector("#pack-offer:not([hidden])");
  const tPack = Date.now();
  await page.click("#pack-button");
  await waitReady(300_000);
  check("C/C++ pack: download + install + compiler start", true, { ms: Date.now() - tPack });
  const cCases = [
    ["C scanf", "main.c", '#include <stdio.h>\nint main(void) { int a, b; scanf("%d %d", &a, &b); printf("%d\\n", a + b); }', "3 4\n", (r) => r.output === "7\n"],
    ["C++ STL", "main.cpp", '#include <bits/stdc++.h>\nusing namespace std;\nint main() { vector<int> v{3, 1, 2}; sort(v.begin(), v.end()); for (int x : v) cout << x; cout << "\\n"; }', "", (r) => r.output === "123\n"],
    ["C compile error", "main.c", "int main(void) { return x; }", "", (r) => r.status === "compile-error" && r.output.includes("undeclared identifier")],
    ["C infinite loop", "main.c", '#include <stdio.h>\nint main(void) { puts("start"); volatile int x = 0; for (;;) x++; }', "", (r) => r.status === "timeout" && r.output.includes("start")],
    ["C stack overflow", "main.c", "int f(int n) { volatile char b[1024]; b[0] = n; return f(n + 1) + b[0]; }\nint main(void) { return f(0); }", "", (r) => r.output.includes("stack overflow")],
    ["C after hostile", "main.c", '#include <stdio.h>\nint main(void) { puts("alive"); }', "", (r) => r.output === "alive\n"],
  ];
  for (const [label, name, code, stdin, ok] of cCases) {
    const r = await runProgram(name, code, stdin);
    check(label, ok(r), { status: r.status, wallMs: r.wallMs, receipt: r.receipt?.trim() });
  }
  await page.screenshot({ path: `${shots}/ran-cpp.png` });

  await runProgram("main.py", 'name = input("Your name: ")\nprint(f"Hello, {name}!")\nprint(undefined_name)', "Asha\n");
  await page.screenshot({ path: `${shots}/ran.png`, fullPage: true });

  const bootInfo = () => page.evaluate(() => {
    const d = document.getElementById("status-dot").dataset;
    return { source: d.boot, workerBootMs: Number(d.bootMs) };
  });
  for (const visit of ["repeat visit", "third visit"]) {
    const t1 = Date.now();
    await page.reload();
    await waitReady(60_000);
    const boot = await bootInfo();
    check(`${visit}: Python restored from snapshot`, boot.source === "snapshot", { readyMs: Date.now() - t1, ...boot });
  }
} else {
  const t0 = Date.now();
  await page.goto(ORIGIN);
  await waitReady(60_000);
  const readyMs = Date.now() - t0;
  const boot = await page.evaluate(() => ({ ...document.getElementById("status-dot").dataset }));
  const nav = await page.evaluate(() => {
    const n = performance.getEntriesByType("navigation")[0];
    return { navStartToResponseMs: Math.round(n.responseStart), workerStart: Math.round(n.workerStart) };
  });
  check("offline: app + Python load with no server", true, { readyMs, ...boot, ...nav });
  const r = await runProgram("main.py", "print(sum(range(10)))");
  check("offline: program runs", r.output === "45\n", { status: r.status });
  const t1 = Date.now();
  const c = await runProgram("main.cpp", '#include <iostream>\nint main() { std::cout << 6 * 7 << "\\n"; }');
  check("offline: C++ compiles and runs (incl. compiler start)", c.output === "42\n", { status: c.status, wallMs: Date.now() - t1, receipt: c.receipt?.trim() });
  await page.screenshot({ path: `${shots}/offline.png` });
}

check("no console errors", errors.length === 0, { errors });
await page.close();
await browser.close();
execFileSync("adb", ["forward", "--remove", `tcp:${DEVTOOLS_PORT}`]);
console.log(JSON.stringify(report, null, 1));
process.exitCode = report.checks.every((c) => c.pass) ? 0 : 1;
