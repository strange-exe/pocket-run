import { expect, openApp, run, test } from "./helpers";

const cp = (...codes: number[]) => String.fromCodePoint(...codes);

test("the Python runtime that is served carries the 512 MB memory cap", async ({ request }) => {
  // scripts/copy-pyodide.mjs patches Pyodide's 4 GB heap maximum; the build stops if it can't.
  const res = await request.get("/sw.js");
  const dir = (await res.text()).match(/pyodide\/([\d.]+-heap\d+)\//)![1];
  expect(dir).toMatch(/-heap512$/);
  const glue = await (await request.get(`/pyodide/${dir}/pyodide.asm.mjs`)).text();
  expect(glue).toContain(`getHeapMax=()=>${512 * 1024 * 1024}`);
  expect(glue).not.toContain("getHeapMax=()=>4294901760");
});

test("the page and its worker scripts are served with the Content-Security-Policy", async ({ page }) => {
  const workerUrls: string[] = [];
  page.on("worker", (w) => workerUrls.push(w.url()));
  const response = await page.goto("/");
  await expect(page.locator("#status-dot")).toHaveAttribute("data-state", "ready", { timeout: 30_000 });
  expect(workerUrls.length).toBeGreaterThan(0);
  for (const url of [response!.url(), ...workerUrls]) {
    const headers = (await page.request.get(url)).headers();
    expect(headers["content-security-policy"], url).toContain("script-src 'self' 'wasm-unsafe-eval'");
    expect(headers["content-security-policy"], url).toContain("object-src 'none'");
    expect(headers["x-content-type-options"], url).toBe("nosniff");
  }
});

test.describe("opening files", () => {
  test("a program renamed to .py is refused and the editor is untouched", async ({ page }) => {
    await openApp(page);
    const before = await page.locator(".cm-content").textContent();
    const exe = Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00, 0x04, 0x00]);
    await page.locator("#file-input").setInputFiles({ name: "homework.py", mimeType: "text/x-python", buffer: exe });
    await expect(page.locator("#notice")).toContainText("Windows program");
    expect(await page.locator(".cm-content").textContent()).toBe(before);
  });

  test("Trojan Source characters are refused", async ({ page }) => {
    await openApp(page);
    const code = `access = "user${cp(0x202e)} ${cp(0x2066)}# admin${cp(0x2069)}"\nprint(access)\n`;
    await page.locator("#file-input").setInputFiles({ name: "check.py", mimeType: "text/plain", buffer: Buffer.from(code) });
    await expect(page.locator("#notice")).toContainText("text-direction");
    await expect(page.locator("#filename")).not.toHaveValue("check.py");
  });

  test("invisible characters are shown, explained, and can be removed", async ({ page }) => {
    await openApp(page);
    const code = `is${cp(0x200b)}_admin = True\nprint(is_admin)\n`;
    await page.locator("#file-input").setInputFiles({ name: "z.py", mimeType: "text/plain", buffer: Buffer.from(code) });
    await expect(page.locator("#notice")).toContainText("1 invisible character");
    await expect(page.locator(".cm-specialChar")).toHaveCount(1);
    await page.locator("#notice-action").click();
    await expect(page.locator(".cm-specialChar")).toHaveCount(0);
    await page.locator("#run-btn").click();
    await expect(page.locator("#receipt")).toHaveAttribute("data-status", "ok", { timeout: 20_000 });
    await expect(page.locator("#output")).toHaveText("True\n");
  });
});

test.describe("share links", () => {
  test("a link carrying hidden direction controls is blocked and nothing is opened", async ({ page }) => {
    await openApp(page);
    const before = await page.locator(".cm-content").textContent();
    const hash = await page.evaluate(async (code) => {
      const packed = await new Response(new Blob([JSON.stringify({ v: 1, f: "a.py", c: code, i: "" })]).stream()
        .pipeThrough(new CompressionStream("deflate-raw"))).arrayBuffer();
      let s = "";
      for (const b of new Uint8Array(packed)) s += String.fromCharCode(b);
      return "#s=" + btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    }, `x = 1 #${cp(0x202e)} hidden`);
    await page.evaluate((h) => { location.hash = h; }, hash);
    await expect(page.locator("#notice")).toContainText("A shared link was blocked");
    expect(await page.locator(".cm-content").textContent()).toBe(before);
  });

  test("Share refuses a file with invisible characters until they are removed", async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]).catch(() => {});
    await openApp(page);
    await page.locator("#file-input").setInputFiles({ name: "s.py", mimeType: "text/plain", buffer: Buffer.from(`a${cp(0x2060)} = 1\n`) });
    await page.locator("#share-btn").click();
    await expect(page.locator("#notice")).toContainText("invisible character");
    await page.locator("#notice-action").click();
    await expect(page.locator("#notice")).toContainText("Press Share again");
    await expect(page.locator(".cm-specialChar")).toHaveCount(0);
  });
});

// Student code can reach JavaScript through Pyodide. It must not reach the site's storage (where the
// offline app itself is cached) or the network, or a shared program could tamper with the app.
test.describe("Python code is isolated from the site's storage and the network", () => {
  test("blocked APIs are gone from the worker", async ({ page }) => {
    await openApp(page);
    const names = ["caches", "indexedDB", "fetch", "XMLHttpRequest", "WebSocket", "EventSource", "importScripts", "Worker", "BroadcastChannel"];
    // Reflect.has checks the whole prototype chain without calling any getter. `js` itself is the
    // worker's global object. Pyodide can't call the `navigator` getter with the real global as
    // `this`, so navigator's members are checked on WorkerNavigator.prototype, where they live.
    const code = [
      "import js",
      `for name in ${JSON.stringify(names)}:`,
      "    print(name, 'present' if js.Reflect.has(js, name) else 'absent')",
      "for name in ['storage', 'serviceWorker']:",
      "    print('navigator.' + name, 'present' if js.Reflect.has(js.WorkerNavigator.prototype, name) else 'absent')",
    ].join("\n");
    const r = await run(page, "main.py", code);
    expect(r.status, r.output).toBe("ok");
    const lines = r.output.trim().split("\n");
    expect(lines).toHaveLength(names.length + 2);
    for (const line of lines) expect(line).toMatch(/ absent$/);
  });

  test("the Content-Security-Policy refuses eval and new Function inside the worker", async ({ page }) => {
    await openApp(page);
    const code = [
      "import js",
      "from pyodide.code import run_js",
      "for label, attempt in [('run_js', lambda: run_js('1 + 1')), ('Function', lambda: js.Function.new('return 1')())]:",
      "    try:",
      "        attempt()",
      "        print(label, 'allowed')",
      "    except Exception as e:",
      "        print(label, 'refused', 'EvalError' in str(e) or 'Content Security Policy' in str(e))",
    ].join("\n");
    const r = await run(page, "main.py", code);
    expect(r.output).toBe("run_js refused True\nFunction refused True\n");
  });

  test("nothing can be written to Cache Storage, by any route", async ({ page }) => {
    await openApp(page);
    const attempts = [
      "from pyodide.code import run_js",
      "import js",
      "def attempt(label, src):",
      "    try:",
      "        run_js(src)",
      "        print(label, 'ran')",
      "    except Exception as e:",
      "        print(label, 'blocked')",
      "attempt('direct', 'caches.open(\"zz-planted\").then(c => c.put(\"/x\", new Response(\"x\")))')",
      "attempt('prototype getter', 'Object.getOwnPropertyDescriptor(WorkerGlobalScope.prototype, \"caches\").get.call(self).open(\"zz-planted\")')",
      "attempt('global this', 'globalThis.caches.open(\"zz-planted\")')",
      "try:",
      "    js.caches.open('zz-planted')",
      "    print('js module', 'ran')",
      "except Exception:",
      "    print('js module', 'blocked')",
    ].join("\n");
    const r = await run(page, "main.py", attempts);
    expect(r.output).not.toContain(" ran");
    await page.waitForTimeout(300);
    expect(await page.evaluate(async () => (await caches.keys()).filter((k) => k.startsWith("zz-")))).toEqual([]);
  });

  test("ordinary programs are unaffected after the lockdown", async ({ page }) => {
    await openApp(page);
    const r = await run(page, "main.py", "import json, math, random\nrandom.seed(1)\nprint(json.dumps({'r': round(math.pi, 2)}))");
    expect(r.output).toBe('{"r": 3.14}\n');
    // The device snapshot is still written by the worker's own private reference.
    await expect.poll(() => page.evaluate(async () => (await caches.keys()).includes("pocket-run-python-snapshot"))).toBe(true);
  });
});
